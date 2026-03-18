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

	DefaultEventRetentionLimit = 512
	DefaultSubscriberBuffer    = 16
)

var (
	ErrInvalidInput      = errors.New("invalid input")
	ErrUnsupportedAction = errors.New("unsupported action")
)

type ActionType string
type ActionStatus string
type CapabilityState string
type ErrorCode string

const (
	ActionTypeSessionStart      ActionType = "ACTION_TYPE_SESSION_START"
	ActionTypeSessionStop       ActionType = "ACTION_TYPE_SESSION_STOP"
	ActionTypeDeviceConnect     ActionType = "ACTION_TYPE_DEVICE_CONNECT"
	ActionTypeDeviceDisconnect  ActionType = "ACTION_TYPE_DEVICE_DISCONNECT"
	ActionTypeStateSync         ActionType = "ACTION_TYPE_STATE_SYNC"
	ActionTypeToolInvoke        ActionType = "ACTION_TYPE_TOOL_INVOKE"
	ActionTypeCapabilityRefresh ActionType = "ACTION_TYPE_CAPABILITY_REFRESH"
)

const (
	ActionStatusRequested ActionStatus = "ACTION_STATUS_REQUESTED"
	ActionStatusAccepted  ActionStatus = "ACTION_STATUS_ACCEPTED"
	ActionStatusRunning   ActionStatus = "ACTION_STATUS_RUNNING"
	ActionStatusCompleted ActionStatus = "ACTION_STATUS_COMPLETED"
	ActionStatusFailed    ActionStatus = "ACTION_STATUS_FAILED"
	ActionStatusCancelled ActionStatus = "ACTION_STATUS_CANCELLED"
)

const (
	CapabilityStateAdded   CapabilityState = "CAPABILITY_STATE_ADDED"
	CapabilityStateUpdated CapabilityState = "CAPABILITY_STATE_UPDATED"
	CapabilityStateRemoved CapabilityState = "CAPABILITY_STATE_REMOVED"
)

const (
	ErrorCodeValidation  ErrorCode = "ERROR_CODE_VALIDATION"
	ErrorCodeUnsupported ErrorCode = "ERROR_CODE_UNSUPPORTED"
	ErrorCodePermission  ErrorCode = "ERROR_CODE_PERMISSION"
	ErrorCodeExecution   ErrorCode = "ERROR_CODE_EXECUTION"
	ErrorCodeTimeout     ErrorCode = "ERROR_CODE_TIMEOUT"
	ErrorCodeTransport   ErrorCode = "ERROR_CODE_TRANSPORT"
)

var supportedActionAliases = map[string]ActionType{
	string(ActionTypeSessionStart):      ActionTypeSessionStart,
	"SESSION_START":                     ActionTypeSessionStart,
	"session.start":                     ActionTypeSessionStart,
	"session_start":                     ActionTypeSessionStart,
	string(ActionTypeSessionStop):       ActionTypeSessionStop,
	"SESSION_STOP":                      ActionTypeSessionStop,
	"session.stop":                      ActionTypeSessionStop,
	"session_stop":                      ActionTypeSessionStop,
	string(ActionTypeDeviceConnect):     ActionTypeDeviceConnect,
	"DEVICE_CONNECT":                    ActionTypeDeviceConnect,
	"device.connect":                    ActionTypeDeviceConnect,
	"device_connect":                    ActionTypeDeviceConnect,
	string(ActionTypeDeviceDisconnect):  ActionTypeDeviceDisconnect,
	"DEVICE_DISCONNECT":                 ActionTypeDeviceDisconnect,
	"device.disconnect":                 ActionTypeDeviceDisconnect,
	"device_disconnect":                 ActionTypeDeviceDisconnect,
	string(ActionTypeStateSync):         ActionTypeStateSync,
	"STATE_SYNC":                        ActionTypeStateSync,
	"state.sync":                        ActionTypeStateSync,
	"state_sync":                        ActionTypeStateSync,
	string(ActionTypeToolInvoke):        ActionTypeToolInvoke,
	"TOOL_INVOKE":                       ActionTypeToolInvoke,
	"tool.invoke":                       ActionTypeToolInvoke,
	"tool_invoke":                       ActionTypeToolInvoke,
	string(ActionTypeCapabilityRefresh): ActionTypeCapabilityRefresh,
	"CAPABILITY_REFRESH":                ActionTypeCapabilityRefresh,
	"capability.refresh":                ActionTypeCapabilityRefresh,
	"capability_refresh":                ActionTypeCapabilityRefresh,
}

type Options struct {
	ServiceName          string
	Version              string
	ProtocolVersion      string
	EventRetentionLimit  int
	SubscriberBufferSize int
}

type Service struct {
	mu                   sync.RWMutex
	info                 ServerInfo
	capabilities         []Capability
	events               []Event
	subscribers          map[int]subscriber
	nextSubID            int
	eventRetentionLimit  int
	subscriberBufferSize int
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
	SupportedActions []ActionType   `json:"supported_actions"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

type Action struct {
	RequestID   string         `json:"request_id"`
	Type        ActionType     `json:"type"`
	Source      string         `json:"source"`
	Target      string         `json:"target,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
	RequestedAt time.Time      `json:"requested_at,omitempty"`
}

type ExecuteActionResponse struct {
	RequestID string         `json:"request_id"`
	Status    ActionStatus   `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     *ErrorDetail   `json:"error,omitempty"`
}

type ErrorDetail struct {
	Code     ErrorCode      `json:"code"`
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
	Status   ActionStatus   `json:"status"`
	Progress map[string]any `json:"progress,omitempty"`
	Error    *ErrorDetail   `json:"error,omitempty"`
}

type CapabilityEvent struct {
	Capability Capability      `json:"capability"`
	State      CapabilityState `json:"state"`
}

type HeartbeatEvent struct {
	Source string    `json:"source"`
	SentAt time.Time `json:"sent_at"`
}

func NewService(options Options) *Service {
	serviceName := strings.TrimSpace(options.ServiceName)
	if serviceName == "" {
		serviceName = "zhihandd"
	}
	version := strings.TrimSpace(options.Version)
	if version == "" {
		version = "0.9.2-dev"
	}
	protocolVersion := strings.TrimSpace(options.ProtocolVersion)
	if protocolVersion == "" {
		protocolVersion = "zhihand.control.v1"
	}
	eventRetentionLimit := options.EventRetentionLimit
	if eventRetentionLimit <= 0 {
		eventRetentionLimit = DefaultEventRetentionLimit
	}
	subscriberBufferSize := options.SubscriberBufferSize
	if subscriberBufferSize <= 0 {
		subscriberBufferSize = DefaultSubscriberBuffer
	}

	capabilities := defaultCapabilities()
	service := &Service{
		info: ServerInfo{
			ServiceName:     serviceName,
			Version:         version,
			ProtocolVersion: protocolVersion,
			Capabilities:    cloneCapabilities(capabilities),
		},
		capabilities:         cloneCapabilities(capabilities),
		events:               make([]Event, 0, maxInt(len(capabilities)+8, eventRetentionLimit)),
		subscribers:          make(map[int]subscriber),
		eventRetentionLimit:  eventRetentionLimit,
		subscriberBufferSize: subscriberBufferSize,
	}

	for _, capability := range capabilities {
		service.appendEventLocked(Event{
			EventID:    newID("evt"),
			Topic:      TopicCapability,
			OccurredAt: time.Now().UTC(),
			CapabilityEvent: &CapabilityEvent{
				Capability: capability,
				State:      CapabilityStateAdded,
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
	canonicalType, err := canonicalActionType(string(action.Type))
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
		Status:    ActionStatusAccepted,
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
			Status: ActionStatusCompleted,
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

	ch := make(chan Event, s.subscriberBufferSize)
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
	now := time.Now().UTC()
	event := Event{
		EventID:    newID("evt"),
		Topic:      TopicHeartbeat,
		OccurredAt: now,
		HeartbeatEvent: &HeartbeatEvent{
			Source: source,
			SentAt: now,
		},
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.appendEventLocked(event)
	return event
}

func (s *Service) appendEventLocked(event Event) {
	s.events = appendBoundedEvent(s.events, cloneEvent(event), s.eventRetentionLimit)
	for _, sub := range s.subscribers {
		if !matchesTopic(sub.topics, event.Topic) {
			continue
		}
		enqueueSubscriberEvent(sub.ch, cloneEvent(event))
	}
}

func appendBoundedEvent(events []Event, event Event, limit int) []Event {
	if limit <= 0 {
		return append(events, event)
	}
	if len(events) >= limit {
		copy(events, events[1:])
		events[len(events)-1] = event
		return events
	}
	return append(events, event)
}

func enqueueSubscriberEvent(ch chan Event, event Event) {
	select {
	case ch <- event:
	default:
		select {
		case <-ch:
		default:
		}
		select {
		case ch <- event:
		default:
		}
	}
}

func defaultCapabilities() []Capability {
	return []Capability{
		{
			ID:               "capability.discovery",
			DisplayName:      "Capability Discovery",
			Version:          "v1",
			SupportedActions: []ActionType{ActionTypeCapabilityRefresh},
			Metadata: map[string]any{
				"kind":      "registry",
				"transport": []string{"http", "sse"},
			},
		},
		{
			ID:               "control.session",
			DisplayName:      "Session Control",
			Version:          "v1",
			SupportedActions: []ActionType{ActionTypeSessionStart, ActionTypeSessionStop},
			Metadata: map[string]any{
				"kind": "control",
			},
		},
		{
			ID:               "device.runtime",
			DisplayName:      "Device Runtime Bridge",
			Version:          "v1",
			SupportedActions: []ActionType{ActionTypeDeviceConnect, ActionTypeDeviceDisconnect, ActionTypeStateSync},
			Metadata: map[string]any{
				"kind": "device",
			},
		},
		{
			ID:               "tool.invoke",
			DisplayName:      "Tool Invocation",
			Version:          "v1",
			SupportedActions: []ActionType{ActionTypeToolInvoke},
			Metadata: map[string]any{
				"kind": "tool",
			},
		},
	}
}

func canonicalActionType(value string) (ActionType, error) {
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
		cloned[key] = cloneValue(value)
	}
	return cloned
}

func cloneValue(input any) any {
	switch typed := input.(type) {
	case map[string]any:
		return cloneMap(typed)
	case []any:
		cloned := make([]any, len(typed))
		for i, value := range typed {
			cloned[i] = cloneValue(value)
		}
		return cloned
	case []string:
		return slices.Clone(typed)
	default:
		return typed
	}
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

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
