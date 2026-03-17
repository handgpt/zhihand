package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zhihand/zhihand/services/zhihandd/internal/config"
	"github.com/zhihand/zhihand/services/zhihandd/internal/control"
	serverhttp "github.com/zhihand/zhihand/services/zhihandd/internal/http"
)

func main() {
	cfg := config.FromEnv()
	logger := log.New(os.Stdout, "zhihandd ", log.LstdFlags|log.Lmsgprefix)
	service := control.NewService(control.Options{
		ServiceName:         cfg.ServiceName,
		Version:             cfg.Version,
		ProtocolVersion:     cfg.ProtocolVersion,
		EventRetentionLimit: cfg.EventLimit,
	})

	server := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: serverhttp.NewMux(cfg, service),
	}

	go func() {
		logger.Printf(
			"starting zhihandd http=%s service=%s version=%s protocol=%s auth=%t",
			cfg.HTTPAddr,
			cfg.ServiceName,
			cfg.Version,
			cfg.ProtocolVersion,
			cfg.AuthToken != "",
		)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatalf("server failed: %v", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	<-ctx.Done()
	logger.Printf("shutdown requested")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Printf("graceful shutdown failed: %v", err)
	}
}
