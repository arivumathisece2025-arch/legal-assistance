.PHONY: typecheck test dev build

typecheck:
	pnpm run typecheck

test:
	pnpm --filter @workspace/core test

dev:
	pnpm --filter @workspace/api-server run dev

build:
	pnpm run build
