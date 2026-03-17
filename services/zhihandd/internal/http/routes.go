package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/zhihand/zhihand/services/zhihandd/internal/config"
	"github.com/zhihand/zhihand/services/zhihandd/internal/control"
)

type API struct {
	cfg     config.Config
	service *control.Service
}

type executeActionRequest struct {
	Action control.Action `json:"action"`
}

func NewMux(cfg config.Config, service *control.Service) *http.ServeMux {
	api := &API{
		cfg:     cfg,
		service: service,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", api.handleHealthz)
	mux.HandleFunc("/v1/server/info", api.protected(api.handleServerInfo))
	mux.HandleFunc("/v1/capabilities", api.protected(api.handleCapabilities))
	mux.HandleFunc("/v1/actions/execute", api.protected(api.handleExecuteAction))
	mux.HandleFunc("/v1/events", api.protected(api.handleEvents))
	mux.HandleFunc("/v1/events/stream", api.protected(api.handleEventStream))
	return mux
}

func (api *API) protected(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !api.authorizeRequest(w, r) {
			return
		}
		next(w, r)
	}
}

func (api *API) authorizeRequest(w http.ResponseWriter, r *http.Request) bool {
	expected := strings.TrimSpace(api.cfg.AuthToken)
	if expected == "" {
		return true
	}
	got := strings.TrimSpace(r.Header.Get("Authorization"))
	if got == "" {
		w.Header().Set("WWW-Authenticate", `Bearer realm="zhihandd"`)
		writeError(w, http.StatusUnauthorized, errors.New("missing bearer token"))
		return false
	}
	if got != "Bearer "+expected {
		w.Header().Set("WWW-Authenticate", `Bearer realm="zhihandd"`)
		writeError(w, http.StatusUnauthorized, errors.New("invalid bearer token"))
		return false
	}
	return true
}

func (api *API) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}

	info := api.service.GetServerInfo()
	writeJSON(w, http.StatusOK, map[string]any{
		"status":           "ok",
		"service":          info.ServiceName,
		"version":          info.Version,
		"protocol_version": info.ProtocolVersion,
		"http_addr":        api.cfg.HTTPAddr,
		"now":              time.Now().UTC(),
	})
}

func (api *API) handleServerInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}

	writeJSON(w, http.StatusOK, api.service.GetServerInfo())
}

func (api *API) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": api.service.ListCapabilities(),
	})
}

func (api *API) handleExecuteAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, r.Method, http.MethodPost)
		return
	}

	var req executeActionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	resp, err := api.service.ExecuteAction(req.Action)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusAccepted, resp)
}

func (api *API) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}

	limit := 0
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil || parsedLimit < 0 {
			writeError(w, http.StatusBadRequest, errors.New("limit must be a non-negative integer"))
			return
		}
		limit = parsedLimit
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": api.service.ListEvents(r.URL.Query()["topic"], limit),
	})
}

func (api *API) handleEventStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, r.Method, http.MethodGet)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, errors.New("streaming is not supported by this server"))
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	topics := r.URL.Query()["topic"]
	clientID := strings.TrimSpace(r.URL.Query().Get("client_id"))
	if clientID == "" {
		clientID = "client"
	}

	stream, cancel := api.service.Subscribe(topics)
	defer cancel()

	initial := api.service.PublishHeartbeat("stream://" + clientID)
	if err := writeSSE(w, initial); err != nil {
		return
	}
	flusher.Flush()

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case event, ok := <-stream:
			if !ok {
				return
			}
			if err := writeSSE(w, event); err != nil {
				return
			}
			flusher.Flush()
		case <-keepalive.C:
			_, _ = w.Write([]byte(": keepalive\n\n"))
			flusher.Flush()
		}
	}
}

func writeSSE(w http.ResponseWriter, event control.Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(w, "event: %s\n", event.Topic); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "id: %s\n", event.EventID); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "data: %s\n\n", payload); err != nil {
		return err
	}

	return nil
}

func decodeJSON(r *http.Request, target any) error {
	defer r.Body.Close()

	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return err
	}

	var extra json.RawMessage
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("request body must contain a single JSON object")
		}
		return err
	}

	return nil
}

func methodNotAllowed(w http.ResponseWriter, method string, allowed ...string) {
	w.Header().Set("Allow", strings.Join(allowed, ", "))
	writeError(
		w,
		http.StatusMethodNotAllowed,
		fmt.Errorf("method %s is not allowed; allowed methods: %s", method, strings.Join(allowed, ", ")),
	)
}

func writeServiceError(w http.ResponseWriter, err error) {
	statusCode := http.StatusInternalServerError
	switch {
	case errors.Is(err, control.ErrInvalidInput):
		statusCode = http.StatusBadRequest
	case errors.Is(err, control.ErrUnsupportedAction):
		statusCode = http.StatusUnprocessableEntity
	}

	writeError(w, statusCode, err)
}

func writeError(w http.ResponseWriter, statusCode int, err error) {
	writeJSON(w, statusCode, map[string]any{
		"error": map[string]any{
			"message": err.Error(),
		},
	})
}

func writeJSON(w http.ResponseWriter, statusCode int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(payload)
}
