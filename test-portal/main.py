"""Mock partner Labour Portal -- see README.md. In-memory state only,
form-based (not a JSON API), on purpose.

Day 3 update: stores the full Aadhaar number (matching what a real
government labour portal would realistically need for registration, not
just our own app's last-4 display-masking convention) but only ever
*displays* the masked last-4 in the human-facing HTML, same as our own
app. A GET /workers/search?aadhaar=<full number> endpoint exists for the
Sync Worker's deactivation automation to find the right entry by full
Aadhaar match -- this is the realistic shape of "the Portal has a way to
look someone up," not a JSON API (the create/deactivate actions stay
form-based)."""

import itertools
import os

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
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


def _masked(aadhaar_number: str) -> str:
    return aadhaar_number[-4:] if len(aadhaar_number) >= 4 else aadhaar_number


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
    # Display copy only -- aadhaar_number itself is never rendered, only
    # its masked form, same discipline as our own app's UI.
    display_workers = {
        wid: {**w, "aadhaar_display": _masked(w["aadhaar_number"])} for wid, w in _workers.items()
    }
    return templates.TemplateResponse("workers.html", {"request": request, "workers": display_workers})


@app.get("/workers/new", response_class=HTMLResponse)
def new_worker_form(request: Request):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("new_worker.html", {"request": request})


@app.post("/workers/new")
def create_worker(
    request: Request,
    name: str = Form(...),
    aadhaar_number: str = Form(...),
    factory_name: str = Form(...),
    external_ref: str = Form(""),
):
    if not _require_login(request):
        return RedirectResponse("/login", status_code=303)
    worker_id = next(_id_counter)
    _workers[worker_id] = {
        "id": worker_id,
        "name": name,
        "aadhaar_number": aadhaar_number,
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


@app.get("/workers/search")
def search_by_aadhaar(request: Request, aadhaar: str):
    """Full-Aadhaar-number lookup -- the realistic shape of "the Portal
    can look someone up," used by the Sync Worker's deactivation
    automation instead of guessing at a Portal-internal ID. Returns JSON
    since this is a lookup the automation parses programmatically, not a
    page a human reads -- doesn't need to be form-based like the
    create/deactivate actions do."""
    if not _require_login(request):
        return JSONResponse({"error": "not logged in"}, status_code=401)
    matches = [
        {"id": w["id"], "name": w["name"], "status": w["status"]}
        for w in _workers.values()
        if w["aadhaar_number"] == aadhaar
    ]
    return JSONResponse({"matches": matches})


@app.get("/")
def root():
    return RedirectResponse("/login")
