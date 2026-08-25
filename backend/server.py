from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict, Any, Literal
import uuid
from datetime import datetime, timedelta
import json
import random
import hashlib
import binascii
import secrets
import jwt
import re
import httpx
from bs4 import BeautifulSoup

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT configuration. In production, set JWT_SECRET as an environment
# variable on the hosting platform (Render) so tokens survive restarts.
# Without it, a random secret is generated at startup — still secure, but
# every deploy/restart invalidates existing sessions (users just log in again).
JWT_SECRET = os.environ.get('JWT_SECRET') or secrets.token_hex(32)
JWT_ALGORITHM = 'HS256'
JWT_EXPIRY_HOURS = 12

# Lightweight in-memory rate limiting (per IP, per endpoint family). Good
# enough for a single small instance; note it resets on restart and isn't
# shared across multiple instances — acceptable for this app's scale, but
# worth swapping for Redis-backed limiting if traffic grows significantly.
import time as _time
from collections import defaultdict as _defaultdict

_rate_limit_buckets: Dict[str, list] = _defaultdict(list)

def rate_limit(key_prefix: str, max_requests: int, window_seconds: int):
    async def _dependency(request: Request):
        client_ip = request.client.host if request.client else "unknown"
        key = f"{key_prefix}:{client_ip}"
        now = _time.time()
        bucket = _rate_limit_buckets[key]
        while bucket and bucket[0] <= now - window_seconds:
            bucket.pop(0)
        if len(bucket) >= max_requests:
            raise HTTPException(status_code=429, detail="Troppi tentativi, riprova tra qualche minuto")
        bucket.append(now)
    return _dependency

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

security = HTTPBearer()

# Define Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    password_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    total_attempts: int = 0
    is_admin: bool = False
    token_version: int = 0
    expires_at: Optional[datetime] = None  # None = no expiry (e.g. admin account)
    active_session_id: Optional[str] = None  # enforces a single active login at a time
    
class UserCreate(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class ChangePassword(BaseModel):
    current_password: str
    new_password: str

class StudentCreate(BaseModel):
    username: str
    password: str
    months: int = 6

class StudentExtend(BaseModel):
    months: int

class NoticeCreate(BaseModel):
    title: str
    body: str

class Question(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    subject: str  # Geografia, Normativa statale, Normativa comunale, Lingua Straniera
    question_text: str
    options: List[str]
    correct_answer: int  # Index of correct option (0-3)
    
class QuizAttempt(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    quiz_type: str  # "free", "by_subject", "final_simulation", "review_errors"
    subject: Optional[str] = None  # For subject-specific quizzes
    language: Optional[str] = None  # For final_simulation
    questions: List[str]  # Question IDs
    answers: List[int]  # User's answers (-1 for unanswered)
    correct_answers: List[int]
    score_by_subject: Dict[str, Dict[str, int]]  # {"Geografia": {"correct": 3, "total": 5}}
    total_correct: int
    total_questions: int
    passed: bool
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    time_taken: Optional[int] = None  # in seconds

class QuizStart(BaseModel):
    quiz_type: Literal["free", "by_subject", "final_simulation", "review_errors"]
    subject: Optional[str] = None
    language: Optional[str] = None

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, v):
        if v is not None and v not in ALL_SUBJECTS:
            raise ValueError("Materia non valida")
        return v

    @field_validator("language")
    @classmethod
    def validate_language(cls, v):
        if v is not None and v not in LANGUAGE_OPTIONS:
            raise ValueError("Lingua non valida")
        return v

class QuizSubmit(BaseModel):
    answers: List[int]  # -1 for unanswered

# Sample questions data
# Fixed subjects (always part of the exam) and the 4 selectable foreign languages
FIXED_SUBJECTS = ["Geografia regionale", "Normativa statale e regionale", "Normativa comunale TAXI e NCC"]
LANGUAGE_OPTIONS = ["Inglese", "Francese", "Spagnolo", "Tedesco"]
LANGUAGE_SUBJECTS = [f"Lingua Straniera - {lang}" for lang in LANGUAGE_OPTIONS]
ALL_SUBJECTS = FIXED_SUBJECTS + LANGUAGE_SUBJECTS

SAMPLE_QUESTIONS = {
    "Geografia regionale": [
        {
            "question_text": "Qual è il capoluogo della provincia di Brescia?",
            "options": ["Milano", "Brescia", "Bergamo", "Mantova"],
            "correct_answer": 1
        },
        {
            "question_text": "Quale lago si trova nella provincia di Brescia?",
            "options": ["Lago di Como", "Lago di Garda", "Lago Maggiore", "Lago d'Iseo"],
            "correct_answer": 3
        },
        {
            "question_text": "Qual è la montagna più alta della provincia di Brescia?",
            "options": ["Monte Rosa", "Adamello", "Monte Bianco", "Cervino"],
            "correct_answer": 1
        },
        {
            "question_text": "Quale valle è famosa per la produzione di vino Franciacorta?",
            "options": ["Val Camonica", "Valle Trompia", "Franciacorta", "Valle Sabbia"],
            "correct_answer": 2
        },
        {
            "question_text": "Quale fiume attraversa la città di Brescia?",
            "options": ["Adda", "Oglio", "Mella", "Chiese"],
            "correct_answer": 2
        }
    ],
    "Normativa statale e regionale": [
        {
            "question_text": "Qual è la velocità massima consentita nei centri abitati?",
            "options": ["30 km/h", "40 km/h", "50 km/h", "60 km/h"],
            "correct_answer": 2
        },
        {
            "question_text": "Il conducente di taxi deve essere munito di:",
            "options": ["Patente B", "Patente C", "Licenza comunale", "Tutte le precedenti"],
            "correct_answer": 3
        },
        {
            "question_text": "La revisione del veicolo deve essere effettuata ogni:",
            "options": ["1 anno", "2 anni", "3 anni", "4 anni"],
            "correct_answer": 1
        },
        {
            "question_text": "L'assicurazione RCA è:",
            "options": ["Facoltativa", "Obbligatoria", "Solo per taxi", "Solo per NCC"],
            "correct_answer": 1
        },
        {
            "question_text": "Il tachimetro deve essere tarato ogni:",
            "options": ["6 mesi", "1 anno", "2 anni", "3 anni"],
            "correct_answer": 2
        }
    ],
    "Normativa comunale TAXI e NCC": [
        {
            "question_text": "La licenza taxi è valida per:",
            "options": ["1 anno", "3 anni", "5 anni", "Tempo indeterminato"],
            "correct_answer": 3
        },
        {
            "question_text": "Il servizio NCC può essere prenotato:",
            "options": ["Solo telefonicamente", "Solo online", "In qualsiasi modo", "Solo presso l'ufficio"],
            "correct_answer": 2
        },
        {
            "question_text": "Il taxi può sostare:",
            "options": ["Ovunque", "Solo in posteggio", "Solo su chiamata", "In zone ZTL"],
            "correct_answer": 1
        },
        {
            "question_text": "La tariffa taxi viene stabilita da:",
            "options": ["Il conducente", "Il comune", "La regione", "Lo stato"],
            "correct_answer": 1
        },
        {
            "question_text": "Il servizio NCC deve tornare in rimessa:",
            "options": ["Mai", "Sempre", "Dopo ogni servizio", "Solo di notte"],
            "correct_answer": 2
        }
    ],
    "Lingua Straniera - Inglese": [
        {
            "question_text": "Come si dice 'aeroporto' in inglese?",
            "options": ["Station", "Airport", "Port", "Terminal"],
            "correct_answer": 1
        },
        {
            "question_text": "Come si dice 'quanto costa?' in inglese?",
            "options": ["How much?", "How many?", "How far?", "How long?"],
            "correct_answer": 0
        },
        {
            "question_text": "Come si dice 'stazione' in inglese?",
            "options": ["Stop", "Station", "Place", "Location"],
            "correct_answer": 1
        },
        {
            "question_text": "Come si dice 'centro città' in inglese?",
            "options": ["City center", "Town hall", "Main street", "Downtown"],
            "correct_answer": 0
        },
        {
            "question_text": "Come si dice 'biglietto' in inglese?",
            "options": ["Bill", "Ticket", "Receipt", "Paper"],
            "correct_answer": 1
        }
    ]
}

def hash_password(password: str) -> str:
    """PBKDF2-HMAC-SHA256 with a random salt, 260k iterations (NIST-recommended)."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 260000)
    return 'pbkdf2$' + binascii.hexlify(salt).decode() + '$' + binascii.hexlify(dk).decode()

def verify_password(password: str, stored_hash: str) -> bool:
    """Verifies against the new PBKDF2 scheme, or the legacy plain SHA-256
    scheme (for accounts created before this upgrade — callers should
    re-hash and save on a successful legacy match, see login_user)."""
    if stored_hash.startswith('pbkdf2$'):
        try:
            _, salt_hex, hash_hex = stored_hash.split('$')
            salt = binascii.unhexlify(salt_hex)
            dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 260000)
            return secrets.compare_digest(binascii.hexlify(dk).decode(), hash_hex)
        except (ValueError, binascii.Error):
            return False
    # Legacy unsalted SHA-256 hash
    return secrets.compare_digest(stored_hash, hashlib.sha256(password.encode()).hexdigest())

def is_legacy_hash(stored_hash: str) -> bool:
    return not stored_hash.startswith('pbkdf2$')

def add_months(dt: datetime, months: int) -> datetime:
    """Adds calendar months to a date, correctly rolling over year/month
    boundaries and clamping the day if the target month is shorter."""
    import calendar
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)

def create_access_token(user_id: str, token_version: int, session_id: str) -> str:
    payload = {
        'sub': user_id,
        'tv': token_version,
        'sid': session_id,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRY_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sessione scaduta, effettua di nuovo il login")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication")

    user = await db.users.find_one({"id": payload.get("sub")})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid authentication")
    # A password change bumps token_version, instantly invalidating older tokens
    if user.get("token_version", 0) != payload.get("tv", 0):
        raise HTTPException(status_code=401, detail="Sessione non più valida, effettua di nuovo il login")
    # Single active session per account: a login elsewhere replaces
    # active_session_id, which invalidates this (now stale) token.
    token_sid = payload.get("sid")
    current_sid = user.get("active_session_id")
    if token_sid and current_sid and token_sid != current_sid:
        raise HTTPException(status_code=401, detail="Hai effettuato l'accesso da un altro dispositivo. Effettua di nuovo il login.")
    # Account expiry (e.g. a student's 6-month access window)
    expires_at = user.get("expires_at")
    if expires_at and datetime.utcnow() > expires_at:
        raise HTTPException(status_code=401, detail="Il tuo accesso è scaduto. Contatta la scuola guida per il rinnovo.")
    return User(**user)

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

# Initialize database with sample questions
async def init_db():
    # Check if questions already exist
    existing_questions = await db.questions.count_documents({})
    if existing_questions == 0:
        questions_to_insert = []
        for subject, questions in SAMPLE_QUESTIONS.items():
            for q in questions:
                question = Question(
                    subject=subject,
                    question_text=q["question_text"],
                    options=q["options"],
                    correct_answer=q["correct_answer"]
                )
                questions_to_insert.append(question.dict())
        
        if questions_to_insert:
            await db.questions.insert_many(questions_to_insert)
            print(f"Inserted {len(questions_to_insert)} sample questions")
    
    # Create admin user if it doesn't exist. A random password is generated
    # so there's never a predictable admin/admin123 credential in the wild —
    # it's logged once here; change it via "Cambia Password" after first login.
    admin_user = await db.users.find_one({"username": "admin"})
    if not admin_user:
        generated_password = secrets.token_urlsafe(12)
        admin = User(
            username="admin",
            password_hash=hash_password(generated_password),
            is_admin=True
        )
        await db.users.insert_one(admin.dict())
        logging.getLogger(__name__).warning(
            f"Created admin user 'admin' with a randomly generated password: {generated_password} "
            f"— log in and change it immediately via 'Cambia Password'."
        )

def validate_question_format(question_data: Dict[str, Any]) -> bool:
    """Validate that a question has the correct format"""
    required_fields = ["question_text", "options", "correct_answer"]
    
    for field in required_fields:
        if field not in question_data:
            return False
    
    # Check options is a list of at least 2 strings
    if not isinstance(question_data["options"], list) or len(question_data["options"]) < 2:
        return False
    
    # Check correct_answer is a valid index for the given options
    num_options = len(question_data["options"])
    if not isinstance(question_data["correct_answer"], int) or not (0 <= question_data["correct_answer"] < num_options):
        return False
    
    return True

# Auth endpoints
# Public self-registration is disabled: student accounts are provisioned
# by the admin (see /admin/students below) so access can't be casually
# shared, and general-public accounts will go through a future paid signup.
@api_router.post("/auth/login")
async def login_user(login_data: UserLogin, _rl: None = Depends(rate_limit("login", 10, 300))):
    user = await db.users.find_one({"username": login_data.username})
    if not user or not verify_password(login_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    expires_at = user.get("expires_at")
    if expires_at and datetime.utcnow() > expires_at:
        raise HTTPException(status_code=403, detail="Il tuo accesso è scaduto. Contatta la scuola guida per il rinnovo.")

    # Transparently upgrade legacy (unsalted SHA-256) hashes to PBKDF2 on
    # a successful login, so old accounts get stronger security automatically.
    if is_legacy_hash(user["password_hash"]):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": hash_password(login_data.password)}}
        )

    # A fresh session id here immediately invalidates any token issued to a
    # previous login for this same account — one active session at a time.
    session_id = secrets.token_hex(16)
    await db.users.update_one({"id": user["id"]}, {"$set": {"active_session_id": session_id}})

    token_version = user.get("token_version", 0)
    return {
        "message": "Login successful",
        "user_id": user["id"],
        "token": create_access_token(user["id"], token_version, session_id),
        "username": user["username"],
        "is_admin": user.get("is_admin", False)
    }

@api_router.post("/auth/change-password")
async def change_password(data: ChangePassword, current_user: User = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user.id})
    if not user or not verify_password(data.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Password attuale non corretta")

    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="La nuova password deve avere almeno 6 caratteri")

    new_token_version = user.get("token_version", 0) + 1
    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {
            "password_hash": hash_password(data.new_password),
            "token_version": new_token_version
        }}
    )

    # Bumping token_version invalidates every previously issued token
    # (including this request's own), so we hand back a fresh one for the
    # current session — otherwise the user would be logged out immediately.
    return {
        "message": "Password aggiornata con successo",
        "token": create_access_token(current_user.id, new_token_version, current_user.active_session_id)
    }

# Admin endpoints for student account management
@api_router.post("/admin/students")
async def create_student(data: StudentCreate, admin_user: User = Depends(get_admin_user)):
    existing = await db.users.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Questo username è già in uso")
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 6 caratteri")
    if not (1 <= data.months <= 60):
        raise HTTPException(status_code=400, detail="Durata non valida (1-60 mesi)")

    student = User(
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=False,
        expires_at=add_months(datetime.utcnow(), data.months)
    )
    await db.users.insert_one(student.dict())
    return {
        "id": student.id,
        "username": student.username,
        "expires_at": student.expires_at.isoformat()
    }

@api_router.get("/admin/students")
async def list_students(admin_user: User = Depends(get_admin_user)):
    students = await db.users.find({"is_admin": False}).to_list(2000)
    now = datetime.utcnow()
    return [
        {
            "id": s["id"],
            "username": s["username"],
            "created_at": s["created_at"].isoformat() if s.get("created_at") else None,
            "expires_at": s["expires_at"].isoformat() if s.get("expires_at") else None,
            "expired": bool(s.get("expires_at")) and s["expires_at"] < now
        }
        for s in sorted(students, key=lambda x: x.get("username", ""))
    ]

@api_router.post("/admin/students/{student_id}/extend")
async def extend_student(student_id: str, data: StudentExtend, admin_user: User = Depends(get_admin_user)):
    student = await db.users.find_one({"id": student_id, "is_admin": False})
    if not student:
        raise HTTPException(status_code=404, detail="Studente non trovato")
    if not (1 <= data.months <= 60):
        raise HTTPException(status_code=400, detail="Durata non valida (1-60 mesi)")

    # Extend from the current expiry if still valid, otherwise from today
    base = student.get("expires_at") or datetime.utcnow()
    if base < datetime.utcnow():
        base = datetime.utcnow()
    new_expiry = add_months(base, data.months)

    await db.users.update_one({"id": student_id}, {"$set": {"expires_at": new_expiry}})
    return {"id": student_id, "expires_at": new_expiry.isoformat()}

@api_router.delete("/admin/students/{student_id}")
async def revoke_student(student_id: str, admin_user: User = Depends(get_admin_user)):
    student = await db.users.find_one({"id": student_id, "is_admin": False})
    if not student:
        raise HTTPException(status_code=404, detail="Studente non trovato")
    # Invalidate any active session immediately, then remove the account
    await db.users.delete_one({"id": student_id})
    return {"message": "Accesso revocato"}

@api_router.post("/admin/students/{student_id}/reset-password")
async def reset_student_password(student_id: str, admin_user: User = Depends(get_admin_user)):
    student = await db.users.find_one({"id": student_id, "is_admin": False})
    if not student:
        raise HTTPException(status_code=404, detail="Studente non trovato")

    new_password = secrets.token_urlsafe(9)  # short, readable-ish temporary password
    await db.users.update_one(
        {"id": student_id},
        {"$set": {
            "password_hash": hash_password(new_password),
            "token_version": student.get("token_version", 0) + 1,  # logs out any existing session
            "active_session_id": None
        }}
    )
    return {"username": student["username"], "new_password": new_password}

# Notices ("what's new" / news feed) — a mix of things the admin writes by
# hand (e.g. app updates) and automatic alerts (e.g. a new exam session
# published by the Provincia), all shown to every logged-in user.
@api_router.get("/notices")
async def list_notices(current_user: User = Depends(get_current_user)):
    notices = await db.notices.find().sort("created_at", -1).to_list(20)
    return [
        {
            "id": n["id"],
            "title": n["title"],
            "body": n["body"],
            "source": n.get("source", "admin"),
            "url": n.get("url"),
            "created_at": n["created_at"].isoformat()
        }
        for n in notices
    ]

@api_router.post("/admin/notices")
async def create_notice(data: NoticeCreate, admin_user: User = Depends(get_admin_user)):
    notice = {
        "id": str(uuid.uuid4()),
        "title": data.title,
        "body": data.body,
        "source": "admin",
        "url": None,
        "created_at": datetime.utcnow()
    }
    await db.notices.insert_one(notice)
    return {"message": "Notizia pubblicata"}

@api_router.delete("/admin/notices/{notice_id}")
async def delete_notice(notice_id: str, admin_user: User = Depends(get_admin_user)):
    result = await db.notices.delete_one({"id": notice_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notizia non trovata")
    return {"message": "Notizia eliminata"}

# --- Automatic check for new NCC/Taxi exam session announcements on the
# Provincia di Brescia website. Best-effort: if the site's markup changes,
# this simply stops finding matches rather than breaking anything else.
# Trigger it periodically with an external scheduler (e.g. cron-job.org)
# hitting POST /api/check-bando?key=<BANDO_CHECK_SECRET> — see deploy notes.
PROVINCIA_NOTIZIE_URL = "https://www.provincia.brescia.it/pagina133701_notizie.html"
BANDO_REQUIRED_KEYWORDS = ["conducenti"]
BANDO_ANY_KEYWORDS = ["non di linea", "ncc", "taxi"]

async def _find_bando_notices(debug_info: dict = None):
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as http_client:
        response = await http_client.get(
            PROVINCIA_NOTIZIE_URL,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
            }
        )
        response.raise_for_status()
        html = response.text

    soup = BeautifulSoup(html, "html.parser")
    all_links = soup.find_all("a", href=True)
    found = []
    seen_ids = set()
    area_notizia_count = 0
    for link in all_links:
        match = re.search(r"/area_letturaNotizia/(\d+)/", link["href"])
        if not match:
            continue
        area_notizia_count += 1
        notice_id = match.group(1)
        if notice_id in seen_ids:
            continue

        text = link.get_text(" ", strip=True)
        parent = link.find_parent()
        context = (text + " " + parent.get_text(" ", strip=True)) if parent else text
        context_lower = context.lower()

        if any(k in context_lower for k in BANDO_REQUIRED_KEYWORDS) and \
           any(k in context_lower for k in BANDO_ANY_KEYWORDS):
            seen_ids.add(notice_id)
            full_url = link["href"] if link["href"].startswith("http") else f"https://www.provincia.brescia.it{link['href']}"
            found.append({"id": notice_id, "title": text[:200] or "Nuovo avviso NCC", "url": full_url})

    if debug_info is not None:
        debug_info.update({
            "status_code": response.status_code,
            "html_length": len(html),
            "total_links": len(all_links),
            "area_notizia_links": area_notizia_count,
        })

    return found

@api_router.api_route("/check-bando", methods=["GET", "POST"])
async def check_bando(key: str = ""):
    expected_key = os.environ.get("BANDO_CHECK_SECRET")
    if not expected_key or key != expected_key:
        raise HTTPException(status_code=403, detail="Not authorized")

    debug_info = {}
    try:
        found = await _find_bando_notices(debug_info)
    except Exception as e:
        logging.getLogger(__name__).exception("Bando check failed")
        return {"checked": True, "error": f"Impossibile verificare il sito: {type(e).__name__}: {e}", "new_notices": 0, "debug": debug_info}

    state = await db.bando_watch.find_one({"_id": "state"})
    known_ids = set(state.get("known_ids", [])) if state else set()
    new_items = [item for item in found if item["id"] not in known_ids]

    for item in new_items:
        await db.notices.insert_one({
            "id": str(uuid.uuid4()),
            "title": "Nuova sessione d'esame NCC pubblicata dalla Provincia",
            "body": item["title"],
            "source": "auto-bando",
            "url": item["url"],
            "created_at": datetime.utcnow()
        })

    all_ids = known_ids | {item["id"] for item in found}
    await db.bando_watch.update_one(
        {"_id": "state"},
        {"$set": {"known_ids": list(all_ids), "last_checked": datetime.utcnow()}},
        upsert=True
    )

    return {"checked": True, "new_notices": len(new_items), "found_total": len(found), "debug": debug_info}


# Admin endpoints for question management
@api_router.get("/admin/questions-count")
async def get_questions_count(admin_user: User = Depends(get_admin_user)):
    """Get count of questions by subject"""
    subjects = ALL_SUBJECTS
    
    counts = {}
    for subject in subjects:
        count = await db.questions.count_documents({"subject": subject})
        counts[subject] = count
    
    return counts

MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024  # 2 MB
MAX_QUESTIONS_PER_UPLOAD = 3000
MAX_QUESTION_TEXT_LENGTH = 1000
MAX_OPTION_LENGTH = 500
MAX_OPTIONS_PER_QUESTION = 8

@api_router.post("/admin/upload-questions")
async def upload_questions(
    subject: str = Form(...),
    questions_file: UploadFile = File(...),
    admin_user: User = Depends(get_admin_user),
    _rl: None = Depends(rate_limit("upload", 20, 600))
):
    """Upload questions for a specific subject"""
    
    # Validate subject
    valid_subjects = ALL_SUBJECTS
    
    if subject not in valid_subjects:
        raise HTTPException(status_code=400, detail=f"Invalid subject. Must be one of: {valid_subjects}")

    content = await questions_file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail=f"File troppo grande (massimo {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB)")

    try:
        questions_data = json.loads(content.decode('utf-8'))

        if not isinstance(questions_data, list):
            raise HTTPException(status_code=400, detail="JSON file must contain an array of questions")

        if len(questions_data) > MAX_QUESTIONS_PER_UPLOAD:
            raise HTTPException(status_code=400, detail=f"Troppe domande nel file (massimo {MAX_QUESTIONS_PER_UPLOAD})")

        # Validate each question's shape, content limits, and option count
        for i, question in enumerate(questions_data):
            if not validate_question_format(question):
                raise HTTPException(status_code=400,
                                  detail=f"Question {i+1} has invalid format. Required fields: question_text, options (2-{MAX_OPTIONS_PER_QUESTION} items), correct_answer")
            if len(question["options"]) > MAX_OPTIONS_PER_QUESTION:
                raise HTTPException(status_code=400, detail=f"Question {i+1}: troppe opzioni (massimo {MAX_OPTIONS_PER_QUESTION})")
            if len(question["question_text"]) > MAX_QUESTION_TEXT_LENGTH:
                raise HTTPException(status_code=400, detail=f"Question {i+1}: testo troppo lungo (massimo {MAX_QUESTION_TEXT_LENGTH} caratteri)")
            if any(len(opt) > MAX_OPTION_LENGTH for opt in question["options"]):
                raise HTTPException(status_code=400, detail=f"Question {i+1}: un'opzione supera {MAX_OPTION_LENGTH} caratteri")

        questions_to_insert = []
        for q in questions_data:
            question = Question(
                subject=subject,
                question_text=q["question_text"],
                options=q["options"],
                correct_answer=q["correct_answer"]
            )
            questions_to_insert.append(question.dict())

        if not questions_to_insert:
            raise HTTPException(status_code=400, detail="No valid questions found in file")

        # Atomic swap: if the insert fails partway through, the delete is
        # rolled back too — the subject never ends up with zero questions.
        async with await client.start_session() as session:
            async with session.start_transaction():
                await db.questions.delete_many({"subject": subject}, session=session)
                result = await db.questions.insert_many(questions_to_insert, session=session)

        return {
            "message": f"Successfully uploaded {len(questions_to_insert)} questions for {subject}",
            "subject": subject,
            "questions_count": len(questions_to_insert),
            "inserted_ids": len(result.inserted_ids)
        }

    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file format")
    except Exception:
        logging.getLogger(__name__).exception("Question upload failed")
        raise HTTPException(status_code=500, detail="Errore interno durante il caricamento")

@api_router.post("/admin/reset-sample-questions")
async def reset_sample_questions(admin_user: User = Depends(get_admin_user)):
    """Reset to original sample questions"""
    
    # Delete all existing questions
    await db.questions.delete_many({})
    
    # Insert sample questions
    questions_to_insert = []
    for subject, questions in SAMPLE_QUESTIONS.items():
        for q in questions:
            question = Question(
                subject=subject,
                question_text=q["question_text"],
                options=q["options"],
                correct_answer=q["correct_answer"]
            )
            questions_to_insert.append(question.dict())
    
    if questions_to_insert:
        await db.questions.insert_many(questions_to_insert)
        
        return {
            "message": f"Reset to {len(questions_to_insert)} sample questions",
            "questions_by_subject": {
                subject: len(questions) for subject, questions in SAMPLE_QUESTIONS.items()
            }
        }

@api_router.get("/admin/preview-questions/{subject}")
async def preview_questions(subject: str, admin_user: User = Depends(get_admin_user)):
    """Get preview of questions for a subject"""
    
    questions = await db.questions.find({"subject": subject}).limit(5).to_list(5)
    
    # Remove IDs for preview
    preview_questions = []
    for q in questions:
        preview_questions.append({
            "question_text": q["question_text"],
            "options": q["options"],
            "correct_answer": q["correct_answer"]
        })
    
    return {
        "subject": subject,
        "total_questions": await db.questions.count_documents({"subject": subject}),
        "preview": preview_questions
    }

# Quiz endpoints
@api_router.post("/quiz/start")
async def start_quiz(quiz_data: QuizStart, current_user: User = Depends(get_current_user)):
    questions_query = {}
    num_questions = 5  # Default for subject and final simulation
    
    if quiz_data.quiz_type == "free" and quiz_data.subject:
        questions_query = {"subject": quiz_data.subject}
        num_questions = 1000  # Get all questions for free mode
    elif quiz_data.quiz_type == "by_subject" and quiz_data.subject:
        questions_query = {"subject": quiz_data.subject}
    elif quiz_data.quiz_type == "review_errors":
        mistake_docs = await db.user_mistakes.find({"user_id": current_user.id}).to_list(1000)
        mistake_ids = [m["question_id"] for m in mistake_docs]
        if not mistake_ids:
            raise HTTPException(status_code=400, detail="Nessun errore da ripassare al momento")
        questions_query = {"id": {"$in": mistake_ids}}
        num_questions = 1000
    elif quiz_data.quiz_type == "final_simulation":
        # For final simulation, we need 5 questions from each fixed subject,
        # plus 5 from the language chosen by the user
        if quiz_data.language not in LANGUAGE_OPTIONS:
            raise HTTPException(status_code=400, detail=f"Devi scegliere una lingua tra: {LANGUAGE_OPTIONS}")

        chosen_language_subject = f"Lingua Straniera - {quiz_data.language}"
        all_subjects = FIXED_SUBJECTS + [chosen_language_subject]
        selected_questions = []
        
        for subject in all_subjects:
            subject_questions = await db.questions.find({"subject": subject}).to_list(1000)
            if len(subject_questions) < 5:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{subject}' ha solo {len(subject_questions)} domande caricate: ne servono almeno 5 per avviare la Simulazione Finale. Carica altre domande dal pannello amministratore."
                )
            selected_questions.extend(random.sample(subject_questions, 5))
        
        # Create quiz attempt
        quiz_attempt = QuizAttempt(
            user_id=current_user.id,
            quiz_type=quiz_data.quiz_type,
            questions=[q["id"] for q in selected_questions],
            answers=[-1] * len(selected_questions),
            correct_answers=[q["correct_answer"] for q in selected_questions],
            score_by_subject={},
            total_correct=0,
            total_questions=len(selected_questions),
            passed=False
        )
        
        await db.quiz_attempts.insert_one(quiz_attempt.dict())
        
        # Return questions without correct answers
        questions_for_frontend = []
        for q in selected_questions:
            questions_for_frontend.append({
                "id": q["id"],
                "subject": q["subject"],
                "question_text": q["question_text"],
                "options": q["options"]
            })
        
        return {
            "quiz_id": quiz_attempt.id,
            "questions": questions_for_frontend,
            "quiz_type": quiz_data.quiz_type,
            "time_limit": 1800,  # 30 minutes in seconds
            "expires_at": (quiz_attempt.started_at + timedelta(seconds=1800)).isoformat()
        }
    
    # For free, by_subject and review_errors modes
    questions = await db.questions.find(questions_query).to_list(num_questions)
    
    if quiz_data.quiz_type == "by_subject":
        questions = random.sample(questions, min(5, len(questions)))
    elif quiz_data.quiz_type in ("free", "review_errors"):
        random.shuffle(questions)  # New random order every time
    
    if not questions:
        raise HTTPException(status_code=404, detail="No questions found")
    
    # Create quiz attempt
    quiz_attempt = QuizAttempt(
        user_id=current_user.id,
        quiz_type=quiz_data.quiz_type,
        subject=quiz_data.subject,
        questions=[q["id"] for q in questions],
        answers=[-1] * len(questions),
        correct_answers=[q["correct_answer"] for q in questions],
        score_by_subject={},
        total_correct=0,
        total_questions=len(questions),
        passed=False
    )
    
    await db.quiz_attempts.insert_one(quiz_attempt.dict())
    
    # Return questions. In "free" and "review_errors" modes we include the
    # correct answer so the frontend can give immediate feedback; other
    # modes stay exam-like (hidden).
    questions_for_frontend = []
    for q in questions:
        q_data = {
            "id": q["id"],
            "subject": q["subject"],
            "question_text": q["question_text"],
            "options": q["options"]
        }
        if quiz_data.quiz_type in ("free", "review_errors"):
            q_data["correct_answer"] = q["correct_answer"]
        questions_for_frontend.append(q_data)
    
    return {
        "quiz_id": quiz_attempt.id,
        "questions": questions_for_frontend,
        "quiz_type": quiz_data.quiz_type,
        "subject": quiz_data.subject,
        "time_limit": 1800 if quiz_data.quiz_type == "final_simulation" else None
    }

@api_router.post("/quiz/{quiz_id}/submit")
async def submit_quiz(quiz_id: str, submit_data: QuizSubmit, current_user: User = Depends(get_current_user)):
    quiz_attempt = await db.quiz_attempts.find_one({"id": quiz_id, "user_id": current_user.id})
    if not quiz_attempt:
        raise HTTPException(status_code=404, detail="Quiz not found")

    # Prevent re-submission of an already-completed attempt (would otherwise
    # let someone overwrite a result, re-inflate stats, or re-try answers).
    # The update below is also done atomically on this same condition.
    if quiz_attempt.get("completed_at") is not None:
        raise HTTPException(status_code=409, detail="Questo quiz è già stato consegnato")

    expected_count = len(quiz_attempt["questions"])
    if len(submit_data.answers) != expected_count:
        raise HTTPException(status_code=422, detail=f"Numero di risposte non valido: attese {expected_count}")

    # Every answer must be -1 (unanswered) or a valid option index for its question
    questions = []
    for q_id in quiz_attempt["questions"]:
        question = await db.questions.find_one({"id": q_id})
        questions.append(question)

    for question, user_answer in zip(questions, submit_data.answers):
        if question is None:
            continue  # question was deleted/replaced after the quiz started
        num_options = len(question["options"])
        if user_answer != -1 and not (0 <= user_answer < num_options):
            raise HTTPException(status_code=422, detail="Risposta non valida")

    # Server-side timer enforcement for the timed final simulation — a
    # client can't get extra time by pausing JS or replaying the request.
    expired = False
    if quiz_attempt["quiz_type"] == "final_simulation":
        elapsed = (datetime.utcnow() - quiz_attempt["started_at"]).total_seconds()
        if elapsed > 1800 + 15:  # small grace period for network latency
            expired = True

    # Calculate score
    correct_count = 0
    score_by_subject = {}

    # Calculate scores by subject, and keep the user's "mistakes" list in sync:
    # a wrong (or unanswered) question is recorded, a correctly answered one
    # is cleared, so /review_errors always reflects current gaps.
    for question, user_answer in zip(questions, submit_data.answers):
        if not question:
            continue
        subject = question["subject"]
        is_correct = user_answer == question["correct_answer"]
        
        if subject not in score_by_subject:
            score_by_subject[subject] = {"correct": 0, "total": 0}
        
        score_by_subject[subject]["total"] += 1
        if is_correct:
            score_by_subject[subject]["correct"] += 1
            correct_count += 1
            await db.user_mistakes.delete_one({"user_id": current_user.id, "question_id": question["id"]})
        else:
            await db.user_mistakes.update_one(
                {"user_id": current_user.id, "question_id": question["id"]},
                {"$set": {
                    "user_id": current_user.id,
                    "question_id": question["id"],
                    "subject": subject,
                    "last_wrong_at": datetime.utcnow()
                }},
                upsert=True
            )

    total_answered = len(submit_data.answers)

    # Check if passed (for final simulation)
    if expired:
        passed = False
    elif quiz_attempt["quiz_type"] == "final_simulation":
        # Must have at least 3 correct per each of the 4 expected subjects, and max 8 total errors
        total_errors = total_answered - correct_count
        expected_subjects = FIXED_SUBJECTS + [f"Lingua Straniera - {quiz_attempt.get('language')}"] \
            if quiz_attempt.get("language") else list(score_by_subject.keys())
        subject_requirements_met = all(
            score_by_subject.get(subject, {"correct": 0})["correct"] >= 3
            for subject in expected_subjects
        )
        passed = subject_requirements_met and total_errors <= 8
    elif total_answered > 0:
        passed = correct_count / total_answered > 0.6
    else:
        passed = False

    # Atomic update: only succeeds if the attempt is still un-submitted,
    # closing the race where two near-simultaneous requests could both
    # "win" and double-count a result.
    update_result = await db.quiz_attempts.update_one(
        {"id": quiz_id, "completed_at": None},
        {
            "$set": {
                "answers": submit_data.answers,
                "score_by_subject": score_by_subject,
                "total_correct": correct_count,
                "passed": passed,
                "completed_at": datetime.utcnow(),
                "time_taken": (datetime.utcnow() - quiz_attempt["started_at"]).total_seconds()
            }
        }
    )
    if update_result.matched_count == 0:
        raise HTTPException(status_code=409, detail="Questo quiz è già stato consegnato")
    
    return {
        "quiz_id": quiz_id,
        "total_correct": correct_count,
        "total_questions": total_answered,
        "score_by_subject": score_by_subject,
        "passed": passed,
        "expired": expired,
        "correct_answers": quiz_attempt["correct_answers"]
    }

@api_router.get("/stats")
async def get_user_stats(current_user: User = Depends(get_current_user)):
    all_attempts = await db.quiz_attempts.find({"user_id": current_user.id}).to_list(1000)
    # Abandoned (started but never submitted) attempts shouldn't count as
    # failures in the user's stats — only completed ones do.
    attempts = [a for a in all_attempts if a.get("completed_at") is not None]
    
    # Clean recent attempts for JSON serialization
    recent_attempts = sorted(attempts, key=lambda x: x["started_at"], reverse=True)[:10]
    cleaned_recent = []
    for attempt in recent_attempts:
        cleaned_attempt = {
            "id": attempt["id"],
            "quiz_type": attempt["quiz_type"],
            "subject": attempt.get("subject"),
            "total_correct": attempt["total_correct"],
            "total_questions": attempt["total_questions"],
            "passed": attempt["passed"],
            "started_at": attempt["started_at"].isoformat() if attempt["started_at"] else None,
            "completed_at": attempt["completed_at"].isoformat() if attempt.get("completed_at") else None
        }
        cleaned_recent.append(cleaned_attempt)
    
    stats = {
        "total_attempts": len(attempts),
        "passed_attempts": len([a for a in attempts if a.get("passed", False)]),
        "by_subject": {},
        "recent_attempts": cleaned_recent
    }
    
    # Calculate subject stats
    subjects = ALL_SUBJECTS
    
    for subject in subjects:
        subject_attempts = [a for a in attempts if a.get("subject") == subject or 
                          (a.get("score_by_subject") and subject in a["score_by_subject"])]
        
        if subject_attempts:
            correct_total = sum(a.get("score_by_subject", {}).get(subject, {}).get("correct", 0) for a in subject_attempts)
            questions_total = sum(a.get("score_by_subject", {}).get(subject, {}).get("total", 0) for a in subject_attempts)
            
            stats["by_subject"][subject] = {
                "attempts": len(subject_attempts),
                "accuracy": (correct_total / questions_total * 100) if questions_total > 0 else 0,
                "best_score": max((a.get("score_by_subject", {}).get(subject, {}).get("correct", 0) / 
                                 max(a.get("score_by_subject", {}).get(subject, {}).get("total", 1), 1) * 100) 
                                for a in subject_attempts)
            }
    
    # Score history over time, for the progress chart — only completed
    # (submitted) attempts, oldest to newest, capped to the last 20.
    completed = [a for a in attempts if a.get("completed_at") and a.get("total_questions")]
    completed_sorted = sorted(completed, key=lambda x: x["completed_at"])[-20:]
    stats["history"] = [
        {
            "date": a["completed_at"].isoformat(),
            "percentage": round(a["total_correct"] / a["total_questions"] * 100),
            "passed": a.get("passed", False)
        }
        for a in completed_sorted
    ]

    stats["mistakes_count"] = await db.user_mistakes.count_documents({"user_id": current_user.id})

    return stats

# Include the router in the main app
app.include_router(api_router)

# Only the real frontend domain(s) may call this API with credentials.
# Override/extend via the FRONTEND_ORIGINS env var (comma-separated) on Render
# if you add a custom domain later.
_default_origins = "https://quiz-ncc-taxi-brescia.vercel.app"
allowed_origins = [
    o.strip() for o in os.environ.get("FRONTEND_ORIGINS", _default_origins).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    await init_db()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
