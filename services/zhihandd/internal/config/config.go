package config

import "os"

type Config struct {
	HTTPAddr        string
	GRPCAddr        string
	ServiceName     string
	Version         string
	ProtocolVersion string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:        envOrDefault("ZHIHAND_HTTP_ADDR", ":8787"),
		GRPCAddr:        envOrDefault("ZHIHAND_GRPC_ADDR", ":9797"),
		ServiceName:     envOrDefault("ZHIHAND_SERVICE_NAME", "zhihandd"),
		Version:         envOrDefault("ZHIHAND_VERSION", "0.1.0-dev"),
		ProtocolVersion: envOrDefault("ZHIHAND_PROTOCOL_VERSION", "zhihand.control.v1"),
	}
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}
