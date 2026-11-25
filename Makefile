.PHONY: lint typecheck test build dev

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

test:
	pnpm test

build:
	pnpm run build

dev:
	pnpm --filter @workspace/api-server run dev
