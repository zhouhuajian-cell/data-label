from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """后端配置（读取 .env / 环境变量）"""

    DATABASE_URL: str = "postgresql+asyncpg://gnd:gnd@localhost:5432/gnd_production"
    REDIS_URL: str = "redis://localhost:6379/0"

    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480  # 8 小时

    # 里程差异阈值（百分比）：|验收-供应|/供应 *100 超过则必须填差异说明
    MILEAGE_DIFFERENCE_THRESHOLD: float = 5.0

    CORS_ALLOW_ORIGINS: str = "http://localhost:3000,http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ALLOW_ORIGINS.split(",") if o.strip()]


settings = Settings()
