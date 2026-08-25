from pydantic import BaseModel, EmailStr
from app.schemas.enums import UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    username: str
    role: UserRole
    supplier_id: str | None = None


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: UserRole
    supplier_id: str | None = None
