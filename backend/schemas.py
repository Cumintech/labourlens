from datetime import datetime

from pydantic import BaseModel


class OwnerSignupIn(BaseModel):
    name: str
    mobile: str
    password: str
    factory_name: str


class OwnerLoginIn(BaseModel):
    mobile: str
    password: str


class OwnerOut(BaseModel):
    id: int
    name: str
    mobile: str
    factory_name: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    owner: OwnerOut


class HealthOut(BaseModel):
    status: str
    time: datetime
