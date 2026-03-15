package control

import (
	"testing"
	"time"
)

func TestExecuteActionPublishesEvent(t *testing.T) {
	service := NewService("zhihandd", "test", "zhihand.control.v1")
	events, cancel := service.Subscribe([]string{TopicAction})
	defer cancel()

	resp, err := service.ExecuteAction(Action{
		Type:   "tool.invoke",
		Source: "adapter://test",
		Target: "runtime://device",
		Parameters: map[string]any{
			"tool_name": "ping",
		},
	})
	if err != nil {
		t.Fatalf("ExecuteAction returned error: %v", err)
	}
	if resp.Status != "ACTION_STATUS_ACCEPTED" {
		t.Fatalf("expected accepted status, got %q", resp.Status)
	}

	select {
	case event := <-events:
		if event.Topic != TopicAction {
			t.Fatalf("expected action topic, got %q", event.Topic)
		}
		if event.ActionEvent == nil {
			t.Fatalf("expected action event payload")
		}
		if event.ActionEvent.Action.RequestID != resp.RequestID {
			t.Fatalf("expected request id %q, got %q", resp.RequestID, event.ActionEvent.Action.RequestID)
		}
		if event.ActionEvent.Status != "ACTION_STATUS_COMPLETED" {
			t.Fatalf("expected completed action event, got %q", event.ActionEvent.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for action event")
	}
}

func TestListEventsFiltersAndLimit(t *testing.T) {
	service := NewService("zhihandd", "test", "zhihand.control.v1")
	service.PublishHeartbeat("adapter://one")
	service.PublishHeartbeat("adapter://two")

	events := service.ListEvents([]string{TopicHeartbeat}, 1)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Topic != TopicHeartbeat {
		t.Fatalf("expected heartbeat topic, got %q", events[0].Topic)
	}
	if events[0].HeartbeatEvent == nil || events[0].HeartbeatEvent.Source != "adapter://two" {
		t.Fatalf("expected latest heartbeat source adapter://two, got %+v", events[0].HeartbeatEvent)
	}
}

func TestUnsupportedActionReturnsError(t *testing.T) {
	service := NewService("zhihandd", "test", "zhihand.control.v1")

	if _, err := service.ExecuteAction(Action{
		Type:   "unsupported.action",
		Source: "adapter://test",
	}); err == nil {
		t.Fatalf("expected error for unsupported action")
	}
}

func TestSlowSubscriberIsDroppedInsteadOfSilentlyMissingEvents(t *testing.T) {
	service := NewService("zhihandd", "test", "zhihand.control.v1")
	_, cancel := service.Subscribe([]string{TopicHeartbeat})
	defer cancel()

	for i := 0; i < 32; i++ {
		service.PublishHeartbeat("adapter://slow")
	}

	service.mu.RLock()
	defer service.mu.RUnlock()
	if len(service.subscribers) != 0 {
		t.Fatalf("expected slow subscriber to be removed, got %d active subscribers", len(service.subscribers))
	}
}
