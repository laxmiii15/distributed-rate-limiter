.PHONY: up down dev prod prod2 demo

## Start Redis and wait until it answers PING
up:
	docker compose up -d
	@echo "waiting for redis…"
	@until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do sleep 1; done
	@echo "redis ready on localhost:6380"

down:
	docker compose down

## Run the API in watch mode (port 3000)
dev:
	npm run start:dev

## Production-style run on port 3000
prod:
	npm run start:prod

## A SECOND instance on port 3001 — run alongside `make prod` for the
## distributed test in `make demo`.
prod2:
	PORT=3001 npm run start:prod

## Atomicity + refill + distributed checks (API must be running)
demo:
	npm run demo
