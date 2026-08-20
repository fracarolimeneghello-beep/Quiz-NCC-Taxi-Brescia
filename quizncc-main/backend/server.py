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

class QuizAnswer(BaseModel):
    question_index: int
    answer: int

class QuizSubmit(BaseModel):
    answers: List[int]  # -1 for unanswered

class QuestionUpload(BaseModel):
    subject: str
    questions: List[Dict[str, Any]]

# Sample questions data
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
    "Lingua Straniera": [
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
    return hashlib.sha256(password.encode()).hexdigest()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    user = await db.users.find_one({"id": credentials.credentials})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid authentication")
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
    
    # Create admin user if it doesn't exist
    admin_user = await db.users.find_one({"username": "admin"})
    if not admin_user:
        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            is_admin=True
        )
        await db.users.insert_one(admin.dict())
        print("Created admin user: admin/admin123")

def validate_question_format(question_data: Dict[str, Any]) -> bool:
    """Validate that a question has the correct format"""
    required_fields = ["question_text", "options", "correct_answer"]
    
    for field in required_fields:
        if field not in question_data:
            return False
    
    # Check options is a list of exactly 4 strings
    if not isinstance(question_data["options"], list) or len(question_data["options"]) != 4:
        return False
    
    # Check correct_answer is valid index (0-3)
    if not isinstance(question_data["correct_answer"], int) or question_data["correct_answer"] not in [0, 1, 2, 3]:
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
    
    return {
        "message": "User registered successfully",
        "user_id": user.id,
        "token": user.id  # Simple token system
    }

@api_router.post("/auth/login")
async def login_user(login_data: UserLogin):
    user = await db.users.find_one({"username": login_data.username})
    if not user or user["password_hash"] != hash_password(login_data.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    return {
        "message": "Login successful",
        "user_id": user["id"],
        "token": user["id"],  # Simple token system
        "username": user["username"],
        "is_admin": user.get("is_admin", False)
    }

# Admin endpoints for question management
@api_router.get("/admin/questions-count")
async def get_questions_count(admin_user: User = Depends(get_admin_user)):
    """Get count of questions by subject"""
    subjects = ["Geografia regionale", "Normativa statale e regionale", 
               "Normativa comunale TAXI e NCC", "Lingua Straniera"]
    
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
    valid_subjects = ["Geografia regionale", "Normativa statale e regionale", 
                     "Normativa comunale TAXI e NCC", "Lingua Straniera"]
    
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
        # For final simulation, we need 5 questions from each subject
        all_subjects = ["Geografia regionale", "Normativa statale e regionale", 
                       "Normativa comunale TAXI e NCC", "Lingua Straniera"]
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
    
    # Return questions without correct answers
    questions_for_frontend = []
    for q in questions:
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
        "subject": quiz_data.subject,
        "time_limit": 1800 if quiz_data.quiz_type == "final_simulation" else None
    }

@api_router.post("/quiz/{quiz_id}/submit")
async def submit_quiz(quiz_id: str, submit_data: QuizSubmit, current_user: User = Depends(get_current_user)):
    quiz_attempt = await db.quiz_attempts.find_one({"id": quiz_id, "user_id": current_user.id})
    if not quiz_attempt:
        raise HTTPException(status_code=404, detail="Quiz not found")
    
    # Calculate score
    correct_count = 0
    score_by_subject = {}
    
    # Get questions details
    questions = []
    for q_id in quiz_attempt["questions"]:
        question = await db.questions.find_one({"id": q_id})
        questions.append(question)
    
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
        total_errors = len(submit_data.answers) - correct_count
        subject_requirements_met = all(
            score["correct"] >= 3 for score in score_by_subject.values()
        )
        passed = subject_requirements_met and total_errors <= 8
    else:
        # For other quiz types, consider passed if > 60% correct
        passed = correct_count / len(submit_data.answers) > 0.6
    
    # Update quiz attempt
    await db.quiz_attempts.update_one(
        {"id": quiz_id},
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
    subjects = ["Geografia regionale", "Normativa statale e regionale", 
                "Normativa comunale TAXI e NCC", "Lingua Straniera"]
    
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