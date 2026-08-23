from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import json
import random
import hashlib
import hmac
import secrets
from datetime import timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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
    
class UserCreate(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class ChangePassword(BaseModel):
    current_password: str
    new_password: str

class Question(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    subject: str  # Geografia, Normativa statale, Normativa comunale, Lingua Straniera
    question_text: str
    options: List[str]
    correct_answer: int  # Index of correct option (0-3)
    
class QuizAttempt(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    quiz_type: str  # "free", "by_subject", "final_simulation"
    subject: Optional[str] = None  # For subject-specific quizzes
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
    quiz_type: str
    subject: Optional[str] = None
    language: Optional[str] = None

class QuizAnswer(BaseModel):
    question_index: int
    answer: int

class QuizSubmit(BaseModel):
    answers: List[int]  # -1 for unanswered

class QuestionUpload(BaseModel):
    subject: str
    questions: List[Dict[str, Any]]

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

PASSWORD_SCHEME = "scrypt"
SESSION_TTL = timedelta(hours=8)


def hash_password(password: str) -> str:
    """Hash a password with a unique salt and a memory-hard KDF."""
    salt = secrets.token_bytes(16)
    derived_key = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32
    )
    return f"{PASSWORD_SCHEME}${salt.hex()}${derived_key.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify scrypt hashes and temporarily support legacy unsalted SHA-256."""
    try:
        scheme, salt_hex, expected_hex = stored_hash.split("$", 2)
        if scheme != PASSWORD_SCHEME:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=2**14,
            r=8,
            p=1,
            dklen=32,
        )
        return hmac.compare_digest(actual.hex(), expected_hex)
    except (TypeError, ValueError):
        # Compatibility path: migrate these hashes at the next successful login.
        legacy = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(legacy, stored_hash)


def is_legacy_password_hash(stored_hash: str) -> bool:
    return not stored_hash.startswith(f"{PASSWORD_SCHEME}$")


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    await db.sessions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "token_hash": token_digest(token),
        "created_at": now,
        "expires_at": now + SESSION_TTL,
    })
    return token

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    now = datetime.utcnow()
    session = await db.sessions.find_one({
        "token_hash": token_digest(credentials.credentials),
        "expires_at": {"$gt": now},
    })
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired authentication")
    user = await db.users.find_one({"id": session["user_id"]})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid authentication")
    return User(**user)

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

# Initialize database with sample questions
async def init_db():
    # Enforce identity/session uniqueness and let MongoDB remove expired sessions.
    await db.users.create_index("username", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)

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
    
    # Create admin user if it doesn't exist
    admin_username = os.environ.get("ADMIN_USERNAME", "admin").strip()
    admin_user = await db.users.find_one({"username": admin_username})
    if not admin_user:
        admin_password = os.environ.get("ADMIN_INITIAL_PASSWORD")
        if not admin_password or len(admin_password) < 12:
            raise RuntimeError(
                "ADMIN_INITIAL_PASSWORD must be configured with at least 12 characters "
                "before the first startup"
            )
        admin = User(
            username=admin_username,
            password_hash=hash_password(admin_password),
            is_admin=True
        )
        await db.users.insert_one(admin.dict())
        logger.info("Initial administrator created")

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
@api_router.post("/auth/register")
async def register_user(user_data: UserCreate):
    # Check if user exists
    existing_user = await db.users.find_one({"username": user_data.username})
    if existing_user:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Create new user
    user = User(
        username=user_data.username,
        password_hash=hash_password(user_data.password)
    )
    
    await db.users.insert_one(user.dict())
    token = await create_session(user.id)
    
    return {
        "message": "User registered successfully",
        "user_id": user.id,
        "token": token
    }

@api_router.post("/auth/login")
async def login_user(login_data: UserLogin):
    user = await db.users.find_one({"username": login_data.username})
    if not user or not verify_password(login_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if is_legacy_password_hash(user["password_hash"]):
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": hash_password(login_data.password)}},
        )

    token = await create_session(user["id"])
    
    return {
        "message": "Login successful",
        "user_id": user["id"],
        "token": token,
        "username": user["username"],
        "is_admin": user.get("is_admin", False)
    }

@api_router.post("/auth/change-password")
async def change_password(data: ChangePassword, current_user: User = Depends(get_current_user)):
    user = await db.users.find_one({"id": current_user.id})
    if not user or not verify_password(data.current_password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Password attuale non corretta")

    if len(data.new_password) < 12:
        raise HTTPException(status_code=400, detail="La nuova password deve avere almeno 12 caratteri")

    if hmac.compare_digest(data.current_password, data.new_password):
        raise HTTPException(status_code=400, detail="La nuova password deve essere diversa da quella attuale")

    await db.users.update_one(
        {"id": current_user.id},
        {"$set": {"password_hash": hash_password(data.new_password)}}
    )

    # Revoke every existing session and issue a fresh token for this device.
    await db.sessions.delete_many({"user_id": current_user.id})
    new_token = await create_session(current_user.id)

    return {"message": "Password aggiornata con successo", "token": new_token}


@api_router.post("/auth/logout")
async def logout_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    current_user: User = Depends(get_current_user),
):
    await db.sessions.delete_one({
        "token_hash": token_digest(credentials.credentials),
        "user_id": current_user.id,
    })
    return {"message": "Logout successful"}

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

@api_router.post("/admin/upload-questions")
async def upload_questions(
    subject: str = Form(...),
    questions_file: UploadFile = File(...),
    admin_user: User = Depends(get_admin_user)
):
    """Upload questions for a specific subject"""
    
    # Validate subject
    valid_subjects = ALL_SUBJECTS
    
    if subject not in valid_subjects:
        raise HTTPException(status_code=400, detail=f"Invalid subject. Must be one of: {valid_subjects}")
    
    # Read and validate JSON file
    try:
        content = await questions_file.read()
        questions_data = json.loads(content.decode('utf-8'))
        
        if not isinstance(questions_data, list):
            raise HTTPException(status_code=400, detail="JSON file must contain an array of questions")
        
        # Validate each question
        for i, question in enumerate(questions_data):
            if not validate_question_format(question):
                raise HTTPException(status_code=400, 
                                  detail=f"Question {i+1} has invalid format. Required fields: question_text, options (4 items), correct_answer (0-3)")
        
        # Remove existing questions for this subject
        await db.questions.delete_many({"subject": subject})
        
        # Insert new questions
        questions_to_insert = []
        for q in questions_data:
            question = Question(
                subject=subject,
                question_text=q["question_text"],
                options=q["options"],
                correct_answer=q["correct_answer"]
            )
            questions_to_insert.append(question.dict())
        
        if questions_to_insert:
            result = await db.questions.insert_many(questions_to_insert)
            
            return {
                "message": f"Successfully uploaded {len(questions_to_insert)} questions for {subject}",
                "subject": subject,
                "questions_count": len(questions_to_insert),
                "inserted_ids": len(result.inserted_ids)
            }
        else:
            raise HTTPException(status_code=400, detail="No valid questions found in file")
            
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {str(e)}")

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
            if len(subject_questions) >= 5:
                selected_questions.extend(random.sample(subject_questions, 5))
            else:
                selected_questions.extend(subject_questions)
        
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
            "time_limit": 1800  # 30 minutes in seconds
        }
    
    # For free and by_subject modes
    questions = await db.questions.find(questions_query).to_list(num_questions)
    
    if quiz_data.quiz_type == "by_subject":
        questions = random.sample(questions, min(5, len(questions)))
    elif quiz_data.quiz_type == "free":
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
    
    # Return questions. In "free" mode we include the correct answer so the
    # frontend can give immediate feedback; other modes stay exam-like (hidden).
    questions_for_frontend = []
    for q in questions:
        q_data = {
            "id": q["id"],
            "subject": q["subject"],
            "question_text": q["question_text"],
            "options": q["options"]
        }
        if quiz_data.quiz_type == "free":
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

    if quiz_attempt.get("completed_at") is not None:
        raise HTTPException(status_code=409, detail="Quiz already submitted")

    expected_count = len(quiz_attempt["questions"])
    if len(submit_data.answers) != expected_count:
        raise HTTPException(
            status_code=422,
            detail=f"Expected {expected_count} answers, received {len(submit_data.answers)}",
        )

    if any(not isinstance(answer, int) or answer < -1 for answer in submit_data.answers):
        raise HTTPException(status_code=422, detail="Invalid answer value")

    if quiz_attempt["quiz_type"] == "final_simulation":
        elapsed = datetime.utcnow() - quiz_attempt["started_at"]
        if elapsed > timedelta(seconds=1800):
            raise HTTPException(status_code=410, detail="Quiz time limit exceeded")
    
    # Calculate score
    correct_count = 0
    score_by_subject = {}
    
    # Get questions details
    questions = []
    for q_id in quiz_attempt["questions"]:
        question = await db.questions.find_one({"id": q_id})
        if question is None:
            raise HTTPException(status_code=409, detail="Quiz questions are no longer available")
        questions.append(question)

    for question, answer in zip(questions, submit_data.answers):
        if answer >= len(question["options"]):
            raise HTTPException(status_code=422, detail="Invalid answer value")
    
    # Calculate scores by subject
    for i, (question, user_answer) in enumerate(zip(questions, submit_data.answers)):
        subject = question["subject"]
        is_correct = user_answer == question["correct_answer"]
        
        if subject not in score_by_subject:
            score_by_subject[subject] = {"correct": 0, "total": 0}
        
        score_by_subject[subject]["total"] += 1
        if is_correct:
            score_by_subject[subject]["correct"] += 1
            correct_count += 1
    
    # Check if passed (for final simulation)
    passed = False
    if quiz_attempt["quiz_type"] == "final_simulation":
        # Must have at least 3 correct per subject and max 8 total errors
        total_errors = expected_count - correct_count
        expected_subjects = set(FIXED_SUBJECTS)
        expected_subjects.update(
            question["subject"] for question in questions
            if question["subject"] in LANGUAGE_SUBJECTS
        )
        subject_requirements_met = (
            len(expected_subjects) == 4
            and set(score_by_subject) == expected_subjects
            and all(score_by_subject[subject]["correct"] >= 3 for subject in expected_subjects)
        )
        passed = subject_requirements_met and total_errors <= 8
    else:
        # For other quiz types, consider passed if > 60% correct
        passed = correct_count / expected_count > 0.6
    
    # Update quiz attempt
    update_result = await db.quiz_attempts.update_one(
        {"id": quiz_id, "user_id": current_user.id, "completed_at": None},
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
    if update_result.modified_count != 1:
        raise HTTPException(status_code=409, detail="Quiz already submitted")
    
    # Update user stats
    await db.users.update_one(
        {"id": current_user.id},
        {"$inc": {"total_attempts": 1}}
    )
    
    return {
        "quiz_id": quiz_id,
        "total_correct": correct_count,
        "total_questions": len(submit_data.answers),
        "score_by_subject": score_by_subject,
        "passed": passed,
        "correct_answers": quiz_attempt["correct_answers"]
    }

@api_router.get("/stats")
async def get_user_stats(current_user: User = Depends(get_current_user)):
    attempts = await db.quiz_attempts.find({"user_id": current_user.id}).to_list(1000)
    
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
    
    return stats

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
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
