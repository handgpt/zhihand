package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	HTTPAddr        string
	ServiceName     string
	Version         string
	ProtocolVersion string
	AuthToken       string
	EventLimit      int
}

func FromEnv() Config {
	return Config{
		HTTPAddr:        envOrDefault("ZHIHAND_HTTP_ADDR", ":8787"),
		ServiceName:     envOrDefault("ZHIHAND_SERVICE_NAME", "zhihandd"),
		Version:         envOrDefault("ZHIHAND_VERSION", "0.9.14-dev"),
		ProtocolVersion: envOrDefault("ZHIHAND_PROTOCOL_VERSION", "zhihand.control.v1"),
		AuthToken:       strings.TrimSpace(os.Getenv("ZHIHAND_AUTH_TOKEN")),
		EventLimit:      envOrDefaultInt("ZHIHAND_EVENT_LIMIT", 512),
	}
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func envOrDefaultInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
