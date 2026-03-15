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
	service := control.NewService("zhihandd", "test", "zhihand.control.v1")
	mux := NewMux(config.Config{HTTPAddr: ":8787", GRPCAddr: ":9797"}, service)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestExecuteActionAndListEvents(t *testing.T) {
	service := control.NewService("zhihandd", "test", "zhihand.control.v1")
	mux := NewMux(config.Config{HTTPAddr: ":8787", GRPCAddr: ":9797"}, service)

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
