from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class DoctorResponse(BaseModel):
    id: int
    name: str
    username: str


class LoginResponse(BaseModel):
    success: bool
    token: str
    doctor: DoctorResponse
