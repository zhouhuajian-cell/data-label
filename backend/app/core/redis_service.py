"""Redis 防重复提交锁（PRD 3.1）"""
import redis.asyncio as redis
from app.core.config import settings
from app.core.exceptions import DuplicateSubmitError


class RedisService:
    def __init__(self):
        self.client = redis.from_url(settings.REDIS_URL, decode_responses=True)

    async def acquire_submit_lock(self, task_id: str, user_id: str, action: str, expire_seconds: int = 5) -> bool:
        """获取防重锁；已存在则抛 DuplicateSubmitError(429)"""
        key = f"task:submit:{task_id}:{user_id}:{action}"
        result = await self.client.set(key, "1", nx=True, ex=expire_seconds)
        if not result:
            raise DuplicateSubmitError()
        return True

    async def release_submit_lock(self, task_id: str, user_id: str, action: str) -> None:
        key = f"task:submit:{task_id}:{user_id}:{action}"
        await self.client.delete(key)

    async def close(self) -> None:
        await self.client.aclose()


redis_service = RedisService()
