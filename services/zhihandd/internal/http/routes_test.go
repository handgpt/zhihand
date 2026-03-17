package http

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/zhihand/zhihand/services/zhihandd/internal/config"
	"github.com/zhihand/zhihand/services/zhihandd/internal/control"
)

func TestHealthz(t *testing.T) {
	service := control.NewService(control.Options{ServiceName: "zhihandd", Version: "test", ProtocolVersion: "zhihand.control.v1"})
	mux := NewMux(config.Config{HTTPAddr: ":8787"}, service)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestExecuteActionAndListEvents(t *testing.T) {
	service := control.NewService(control.Options{ServiceName: "zhihandd", Version: "test", ProtocolVersion: "zhihand.control.v1"})
	mux := NewMux(config.Config{HTTPAddr: ":8787"}, service)

	body, err := json.Marshal(map[string]any{
		"action": map[string]any{
			"type":   "tool.invoke",
			"source": "adapter://openclaw",
			"target": "runtime://mobile",
			"parameters": map[string]any{
				"tool_name": "ping",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	postReq := httptest.NewRequest(http.MethodPost, "/v1/actions/execute", bytes.NewReader(body))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	mux.ServeHTTP(postRec, postReq)

	if postRec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", postRec.Code, postRec.Body.String())
	}

	getReq := httptest.NewRequest(http.MethodGet, "/v1/events?topic=action&limit=1", nil)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", getRec.Code)
	}

	var payload struct {
		Items []control.Event `json:"items"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("Unmarshal returned error: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 event, got %d", len(payload.Items))
	}
	if payload.Items[0].ActionEvent == nil {
		t.Fatalf("expected action event payload")
	}
}

func TestProtectedRoutesRequireBearerTokenWhenConfigured(t *testing.T) {
	service := control.NewService(control.Options{ServiceName: "zhihandd", Version: "test", ProtocolVersion: "zhihand.control.v1"})
	mux := NewMux(config.Config{HTTPAddr: ":8787", AuthToken: "secret"}, service)

	req := httptest.NewRequest(http.MethodGet, "/v1/server/info", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without bearer token, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/server/info", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with bearer token, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestExecuteActionAllowsUnknownForwardCompatibleFields(t *testing.T) {
	service := control.NewService(control.Options{ServiceName: "zhihandd", Version: "test", ProtocolVersion: "zhihand.control.v1"})
	mux := NewMux(config.Config{HTTPAddr: ":8787"}, service)

	body, err := json.Marshal(map[string]any{
		"action": map[string]any{
			"type":   "tool.invoke",
			"source": "adapter://openclaw",
			"unknown_future_field": map[string]any{
				"enabled": true,
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/actions/execute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for forward-compatible payload, got %d body=%s", rec.Code, rec.Body.String())
	}
}
