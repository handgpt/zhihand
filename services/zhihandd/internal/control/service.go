package control

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	TopicAction     = "action"
	TopicCapability = "capability"
	TopicHeartbeat  = "heartbeat"
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrUnsupportedAction = errors.New("unsupported action")
)

var supportedActionAliases = map[string]string{
	"ACTION_TYPE_SESSION_START":      "ACTION_TYPE_SESSION_START",
	"SESSION_START":                  "ACTION_TYPE_SESSION_START",
	"session.start":                  "ACTION_TYPE_SESSION_START",
	"session_start":                  "ACTION_TYPE_SESSION_START",
	"ACTION_TYPE_SESSION_STOP":       "ACTION_TYPE_SESSION_STOP",
	"SESSION_STOP":                   "ACTION_TYPE_SESSION_STOP",
	"session.stop":                   "ACTION_TYPE_SESSION_STOP",
	"session_stop":                   "ACTION_TYPE_SESSION_STOP",
	"ACTION_TYPE_DEVICE_CONNECT":     "ACTION_TYPE_DEVICE_CONNECT",
	"DEVICE_CONNECT":                 "ACTION_TYPE_DEVICE_CONNECT",
	"device.connect":                 "ACTION_TYPE_DEVICE_CONNECT",
	"device_connect":                 "ACTION_TYPE_DEVICE_CONNECT",
	"ACTION_TYPE_DEVICE_DISCONNECT":  "ACTION_TYPE_DEVICE_DISCONNECT",
	"DEVICE_DISCONNECT":              "ACTION_TYPE_DEVICE_DISCONNECT",
	"device.disconnect":              "ACTION_TYPE_DEVICE_DISCONNECT",
	"device_disconnect":              "ACTION_TYPE_DEVICE_DISCONNECT",
	"ACTION_TYPE_STATE_SYNC":         "ACTION_TYPE_STATE_SYNC",
	"STATE_SYNC":                     "ACTION_TYPE_STATE_SYNC",
	"state.sync":                     "ACTION_TYPE_STATE_SYNC",
	"state_sync":                     "ACTION_TYPE_STATE_SYNC",
	"ACTION_TYPE_TOOL_INVOKE":        "ACTION_TYPE_TOOL_INVOKE",
	"TOOL_INVOKE":                    "ACTION_TYPE_TOOL_INVOKE",
	"tool.invoke":                    "ACTION_TYPE_TOOL_INVOKE",
	"tool_invoke":                    "ACTION_TYPE_TOOL_INVOKE",
	"ACTION_TYPE_CAPABILITY_REFRESH": "ACTION_TYPE_CAPABILITY_REFRESH",
	"CAPABILITY_REFRESH":             "ACTION_TYPE_CAPABILITY_REFRESH",
	"capability.refresh":             "ACTION_TYPE_CAPABILITY_REFRESH",
	"capability_refresh":             "ACTION_TYPE_CAPABILITY_REFRESH",
}

type Service struct {
	mu           sync.RWMutex
	info         ServerInfo
	capabilities []Capability
	events       []Event
	subscribers  map[int]subscriber
	nextSubID    int
}

type subscriber struct {
	topics map[string]struct{}
	ch     chan Event
}

type ServerInfo struct {
	ServiceName     string       `json:"service_name"`
	Version         string       `json:"version"`
	ProtocolVersion string       `json:"protocol_version"`
	Capabilities    []Capability `json:"capabilities"`
}

type Capability struct {
	ID               string         `json:"id"`
	DisplayName      string         `json:"display_name"`
	Version          string         `json:"version"`
	SupportedActions []string       `json:"supported_actions"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type Action struct {
	RequestID   string         `json:"request_id"`
	Type        string         `json:"type"`
	Source      string         `json:"source"`
	Target      string         `json:"target,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
	RequestedAt time.Time      `json:"requested_at,omitempty"`
}

type ExecuteActionResponse struct {
	RequestID string         `json:"request_id"`
	Status    string         `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     *ErrorDetail   `json:"error,omitempty"`
}

type ErrorDetail struct {
	Code     string         `json:"code"`
	Message  string         `json:"message"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type Event struct {
	EventID         string           `json:"event_id"`
	Topic           string           `json:"topic"`
	OccurredAt      time.Time        `json:"occurred_at"`
	ActionEvent     *ActionEvent     `json:"action_event,omitempty"`
	CapabilityEvent *CapabilityEvent `json:"capability_event,omitempty"`
	HeartbeatEvent  *HeartbeatEvent  `json:"heartbeat_event,omitempty"`
}

type ActionEvent struct {
	Action   Action         `json:"action"`
	Status   string         `json:"status"`
	Progress map[string]any `json:"progress,omitempty"`
	Error    *ErrorDetail   `json:"error,omitempty"`
}

type CapabilityEvent struct {
	Capability Capability `json:"capability"`
	State      string     `json:"state"`
}

type HeartbeatEvent struct {
	Source string    `json:"source"`
	SentAt time.Time `json:"sent_at"`
}

func NewService(serviceName string, version string, protocolVersion string) *Service {
	if strings.TrimSpace(serviceName) == "" {
		serviceName = "zhihandd"
	}
	if strings.TrimSpace(version) == "" {
		version = "0.1.0-dev"
	}
	if strings.TrimSpace(protocolVersion) == "" {
		protocolVersion = "zhihand.control.v1"
	}

	capabilities := defaultCapabilities()

	service := &Service{
		info: ServerInfo{
			ServiceName:     serviceName,
			Version:         version,
			ProtocolVersion: protocolVersion,
			Capabilities:    cloneCapabilities(capabilities),
		},
		capabilities: cloneCapabilities(capabilities),
		events:       make([]Event, 0, len(capabilities)+8),
		subscribers:  make(map[int]subscriber),
	}

	for _, capability := range capabilities {
		service.appendEventLocked(Event{
			EventID:    newID("evt"),
			Topic:      TopicCapability,
			OccurredAt: time.Now().UTC(),
			CapabilityEvent: &CapabilityEvent{
				Capability: capability,
				State:      "CAPABILITY_STATE_ADDED",
			},
		})
	}

	return service
}

func (s *Service) GetServerInfo() ServerInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	info := s.info
	info.Capabilities = cloneCapabilities(s.capabilities)
	return info
}

func (s *Service) ListCapabilities() []Capability {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneCapabilities(s.capabilities)
}

func (s *Service) ExecuteAction(action Action) (ExecuteActionResponse, error) {
	canonicalType, err := canonicalActionType(action.Type)
	if err != nil {
		return ExecuteActionResponse{}, err
	}

	if strings.TrimSpace(action.Source) == "" {
		return ExecuteActionResponse{}, fmt.Errorf("%w: source is required", ErrInvalidInput)
	}

	now := time.Now().UTC()
	if strings.TrimSpace(action.RequestID) == "" {
		action.RequestID = newID("act")
	}
	action.Type = canonicalType
	if action.RequestedAt.IsZero() {
		action.RequestedAt = now
	}
	if action.Parameters == nil {
		action.Parameters = map[string]any{}
	}

	response := ExecuteActionResponse{
		RequestID: action.RequestID,
		Status:    "ACTION_STATUS_ACCEPTED",
		Result: map[string]any{
			"accepted":        true,
			"handled_by":      "zhihandd",
			"action_type":     action.Type,
			"target":          action.Target,
			"requested_at":    action.RequestedAt,
			"completed_at":    now,
			"parameter_count": len(action.Parameters),
		},
	}

	event := Event{
		EventID:    newID("evt"),
		Topic:      TopicAction,
		OccurredAt: now,
		ActionEvent: &ActionEvent{
			Action: action,
			Status: "ACTION_STATUS_COMPLETED",
			Progress: map[string]any{
				"phase": "completed",
			},
		},
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.appendEventLocked(event)

	return response, nil
}

func (s *Service) ListEvents(topics []string, limit int) []Event {
	s.mu.RLock()
	defer s.mu.RUnlock()

	filter := makeTopicFilter(topics)
	items := make([]Event, 0, len(s.events))
	for _, event := range s.events {
		if matchesTopic(filter, event.Topic) {
			items = append(items, cloneEvent(event))
		}
	}

	if limit > 0 && len(items) > limit {
		items = slices.Clone(items[len(items)-limit:])
	}

	return items
}

func (s *Service) Subscribe(topics []string) (<-chan Event, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()

	subID := s.nextSubID
	s.nextSubID++

	ch := make(chan Event, 16)
	s.subscribers[subID] = subscriber{
		topics: makeTopicFilter(topics),
		ch:     ch,
	}

	cancel := func() {
		s.mu.Lock()
		defer s.mu.Unlock()

		sub, ok := s.subscribers[subID]
		if !ok {
			return
		}

		delete(s.subscribers, subID)
		close(sub.ch)
	}

	return ch, cancel
}

func (s *Service) PublishHeartbeat(source string) Event {
	if strings.TrimSpace(source) == "" {
		source = "zhihandd"
	}

	event := Event{
		EventID:    newID("evt"),
		Topic:      TopicHeartbeat,
		OccurredAt: time.Now().UTC(),
		HeartbeatEvent: &HeartbeatEvent{
			Source: source,
			SentAt: time.Now().UTC(),
		},
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.appendEventLocked(event)
	return event
}

func (s *Service) appendEventLocked(event Event) {
	s.events = append(s.events, cloneEvent(event))
	for id, sub := range s.subscribers {
		if !matchesTopic(sub.topics, event.Topic) {
			continue
		}

		select {
		case sub.ch <- cloneEvent(event):
		default:
			close(sub.ch)
			delete(s.subscribers, id)
		}
	}
}

func defaultCapabilities() []Capability {
	return []Capability{
		{
			ID:               "capability.discovery",
			DisplayName:      "Capability Discovery",
			Version:          "v1",
			SupportedActions: []string{"ACTION_TYPE_CAPABILITY_REFRESH"},
			Metadata: map[string]any{
				"kind":      "registry",
				"transport": []string{"http", "sse", "grpc"},
			},
		},
		{
			ID:               "control.session",
			DisplayName:      "Session Control",
			Version:          "v1",
			SupportedActions: []string{"ACTION_TYPE_SESSION_START", "ACTION_TYPE_SESSION_STOP"},
			Metadata: map[string]any{
				"kind": "control",
			},
		},
		{
			ID:               "device.runtime",
			DisplayName:      "Device Runtime Bridge",
			Version:          "v1",
			SupportedActions: []string{"ACTION_TYPE_DEVICE_CONNECT", "ACTION_TYPE_DEVICE_DISCONNECT", "ACTION_TYPE_STATE_SYNC"},
			Metadata: map[string]any{
				"kind": "device",
			},
		},
		{
			ID:               "tool.invoke",
			DisplayName:      "Tool Invocation",
			Version:          "v1",
			SupportedActions: []string{"ACTION_TYPE_TOOL_INVOKE"},
			Metadata: map[string]any{
				"kind": "tool",
			},
		},
	}
}

func canonicalActionType(value string) (string, error) {
	key := strings.TrimSpace(value)
	if key == "" {
		return "", fmt.Errorf("%w: action type is required", ErrInvalidInput)
	}

	upperKey := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(key, ".", "_"), "-", "_"))
	if canonical, ok := supportedActionAliases[key]; ok {
		return canonical, nil
	}
	if canonical, ok := supportedActionAliases[upperKey]; ok {
		return canonical, nil
	}

	return "", fmt.Errorf("%w: %s", ErrUnsupportedAction, value)
}

func makeTopicFilter(topics []string) map[string]struct{} {
	filter := make(map[string]struct{})
	for _, topic := range topics {
		normalized := strings.TrimSpace(strings.ToLower(topic))
		if normalized == "" {
			continue
		}
		filter[normalized] = struct{}{}
	}

	return filter
}

func matchesTopic(filter map[string]struct{}, topic string) bool {
	if len(filter) == 0 {
		return true
	}

	_, ok := filter[strings.ToLower(strings.TrimSpace(topic))]
	return ok
}

func cloneCapabilities(items []Capability) []Capability {
	cloned := make([]Capability, 0, len(items))
	for _, item := range items {
		cloned = append(cloned, Capability{
			ID:               item.ID,
			DisplayName:      item.DisplayName,
			Version:          item.Version,
			SupportedActions: slices.Clone(item.SupportedActions),
			Metadata:         cloneMap(item.Metadata),
		})
	}
	return cloned
}

func cloneEvent(event Event) Event {
	cloned := Event{
		EventID:    event.EventID,
		Topic:      event.Topic,
		OccurredAt: event.OccurredAt,
	}

	if event.ActionEvent != nil {
		action := event.ActionEvent.Action
		cloned.ActionEvent = &ActionEvent{
			Action: Action{
				RequestID:   action.RequestID,
				Type:        action.Type,
				Source:      action.Source,
				Target:      action.Target,
				Parameters:  cloneMap(action.Parameters),
				RequestedAt: action.RequestedAt,
			},
			Status:   event.ActionEvent.Status,
			Progress: cloneMap(event.ActionEvent.Progress),
		}
		if event.ActionEvent.Error != nil {
			cloned.ActionEvent.Error = &ErrorDetail{
				Code:     event.ActionEvent.Error.Code,
				Message:  event.ActionEvent.Error.Message,
				Metadata: cloneMap(event.ActionEvent.Error.Metadata),
			}
		}
	}

	if event.CapabilityEvent != nil {
		cloned.CapabilityEvent = &CapabilityEvent{
			Capability: Capability{
				ID:               event.CapabilityEvent.Capability.ID,
				DisplayName:      event.CapabilityEvent.Capability.DisplayName,
				Version:          event.CapabilityEvent.Capability.Version,
				SupportedActions: slices.Clone(event.CapabilityEvent.Capability.SupportedActions),
				Metadata:         cloneMap(event.CapabilityEvent.Capability.Metadata),
			},
			State: event.CapabilityEvent.State,
		}
	}

	if event.HeartbeatEvent != nil {
		cloned.HeartbeatEvent = &HeartbeatEvent{
			Source: event.HeartbeatEvent.Source,
			SentAt: event.HeartbeatEvent.SentAt,
		}
	}

	return cloned
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}

	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}

func newID(prefix string) string {
	value, err := randomID(prefix)
	if err != nil {
		return fallbackID(prefix)
	}
	return value
}

func randomID(prefix string) (string, error) {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}

	token := strings.ToLower(base64.RawURLEncoding.EncodeToString(buf))
	return prefix + "_" + token, nil
}

func fallbackID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UTC().UnixNano())
}
