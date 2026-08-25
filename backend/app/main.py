"""GND 量产数据交互平台后端入口（FastAPI）"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1 import auth, tasks, projects, items, dashboard, settlements, notifications
from app.core.config import settings
from app.core.redis_service import redis_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await redis_service.close()


app = FastAPI(
    title="GND量产数据交互平台",
    version="1.0.0",
    description="多角色协作的测区任务管理系统（FastAPI + PostgreSQL + Redis）",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(projects.router, prefix="/api/v1")
app.include_router(items.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")
app.include_router(settlements.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
