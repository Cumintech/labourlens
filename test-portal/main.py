"""Mock partner Labour Portal -- see README.md. In-memory state only,
form-based (not a JSON API), on purpose."""

import itertools
import os

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

DEMO_USERNAME = "portaladmin"
DEMO_PASSWORD = "portalpass123"

app = FastAPI(title="Test Portal (mock)")
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET", "dev-only-not-secret"))
templates = Jinja2Templates(directory="templates")

_id_counter = itertools.count(1)
# In-memory only -- see README.md for why that's intentional here.
_workers: dict[int, dict] = {}


def _require_login(request: Request) -> bool:
    return request.session.get("logged_in") is True


@app.get("/login", response_class=HTMLResponse)
def login_form(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login")
def login(request: Request, username: str = Form(...), password: str = Form(...)):
    if username == DEMO_USERNAME and password == DEMO_PASSWORD:
        request.session["logged_in"] = True
        return RedirectResponse("/workers", status_code=303)
    return templates.TemplateResponse(
        "login.html", {"request": request, "error": "Invalid username or password"}, status_code=401
    )


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/workers", response_class=HTMLResponse)
def list_workers(request: Request):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse(
        "workers.html", {"request": request, "workers": _workers}
    )


@app.get("/workers/new", response_class=HTMLResponse)
def new_worker_form(request: Request):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("new_worker.html", {"request": request})


@app.post("/workers/new")
def create_worker(
    request: Request,
    name: str = Form(...),
    aadhaar_last4: str = Form(...),
    factory_name: str = Form(...),
    external_ref: str = Form(""),
):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    worker_id = next(_id_counter)
    _workers[worker_id] = {
        "id": worker_id,
        "name": name,
        "aadhaar_last4": aadhaar_last4,
        "factory_name": factory_name,
        "external_ref": external_ref,
        "status": "active",
    }
    return RedirectResponse("/workers", status_code=303)


@app.post("/workers/{worker_id}/deactivate")
def deactivate_worker(request: Request, worker_id: int):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    if worker_id in _workers:
        _workers[worker_id]["status"] = "inactive"
    return RedirectResponse("/workers", status_code=303)


@app.get("/")
def root():
    return RedirectResponse("/login")
