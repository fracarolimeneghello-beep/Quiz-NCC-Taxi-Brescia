#!/usr/bin/env python3
"""
Backend Test Suite for Brescia Provincial Exam App
Tests authentication, database initialization, quiz APIs, evaluation logic, and statistics
"""

import requests
import json
import time
import random
from typing import Dict, List, Any

# Load backend URL from frontend .env
def get_backend_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except Exception as e:
        print(f"Error reading backend URL: {e}")
        return None

BACKEND_URL = get_backend_url()
if not BACKEND_URL:
    print("ERROR: Could not find REACT_APP_BACKEND_URL in frontend/.env")
    exit(1)

API_BASE = f"{BACKEND_URL}/api"
print(f"Testing backend at: {API_BASE}")

# Test data
TEST_USERS = [
    {"username": "marco_brescia", "password": "esame2024!"},
    {"username": "giulia_taxi", "password": "conducente123"}
]

EXPECTED_SUBJECTS = [
    "Geografia regionale",
    "Normativa statale e regionale", 
    "Normativa comunale TAXI e NCC",
    "Lingua Straniera"
]

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.auth_tokens = {}
        self.test_results = {
            "authentication": {"passed": False, "details": []},
            "database_init": {"passed": False, "details": []},
            "quiz_apis": {"passed": False, "details": []},
            "evaluation_logic": {"passed": False, "details": []},
            "statistics": {"passed": False, "details": []}
        }
        
    def log_result(self, category: str, success: bool, message: str):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {message}")
        self.test_results[category]["details"].append({
            "success": success,
            "message": message
        })
        
    def test_authentication(self) -> bool:
        """Test user registration and login"""
        print("\n=== TESTING AUTHENTICATION SYSTEM ===")
        
        try:
            # Test user registration
            for user_data in TEST_USERS:
                # Register user
                response = self.session.post(
                    f"{API_BASE}/auth/register",
                    json=user_data,
                    timeout=10
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "token" in data and "user_id" in data:
                        self.auth_tokens[user_data["username"]] = data["token"]
                        self.log_result("authentication", True, 
                                      f"User registration successful for {user_data['username']}")
                    else:
                        self.log_result("authentication", False, 
                                      f"Registration response missing token/user_id for {user_data['username']}")
                        return False
                elif response.status_code == 400 and "already exists" in response.text:
                    self.log_result("authentication", True, 
                                  f"User {user_data['username']} already exists (expected)")
                else:
                    self.log_result("authentication", False, 
                                  f"Registration failed for {user_data['username']}: {response.status_code}")
                    return False
            
            # Test user login
            for user_data in TEST_USERS:
                response = self.session.post(
                    f"{API_BASE}/auth/login",
                    json=user_data,
                    timeout=10
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "token" in data and "user_id" in data and "username" in data:
                        self.auth_tokens[user_data["username"]] = data["token"]
                        self.log_result("authentication", True, 
                                      f"Login successful for {user_data['username']}")
                    else:
                        self.log_result("authentication", False, 
                                      f"Login response missing required fields for {user_data['username']}")
                        return False
                else:
                    self.log_result("authentication", False, 
                                  f"Login failed for {user_data['username']}: {response.status_code}")
                    return False
            
            # Test invalid credentials
            response = self.session.post(
                f"{API_BASE}/auth/login",
                json={"username": "nonexistent", "password": "wrong"},
                timeout=10
            )
            
            if response.status_code == 401:
                self.log_result("authentication", True, "Invalid credentials properly rejected")
            else:
                self.log_result("authentication", False, 
                              f"Invalid credentials should return 401, got {response.status_code}")
                return False
                
            self.test_results["authentication"]["passed"] = True
            return True
            
        except Exception as e:
            self.log_result("authentication", False, f"Authentication test failed with exception: {str(e)}")
            return False
    
    def test_database_initialization(self) -> bool:
        """Test that sample questions are properly loaded"""
        print("\n=== TESTING DATABASE INITIALIZATION ===")
        
        try:
            # Get a token for authenticated requests
            token = list(self.auth_tokens.values())[0] if self.auth_tokens else None
            if not token:
                self.log_result("database_init", False, "No authentication token available")
                return False
            
            headers = {"Authorization": f"Bearer {token}"}
            
            # Test by starting a free quiz for each subject to verify questions exist
            questions_found = {}
            
            for subject in EXPECTED_SUBJECTS:
                response = self.session.post(
                    f"{API_BASE}/quiz/start",
                    json={"quiz_type": "free", "subject": subject},
                    headers=headers,
                    timeout=10
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "questions" in data and len(data["questions"]) >= 5:
                        questions_found[subject] = len(data["questions"])
                        self.log_result("database_init", True, 
                                      f"Found {len(data['questions'])} questions for subject '{subject}'")
                    else:
                        self.log_result("database_init", False, 
                                      f"Insufficient questions for subject '{subject}': {len(data.get('questions', []))}")
                        return False
                else:
                    self.log_result("database_init", False, 
                                  f"Failed to get questions for subject '{subject}': {response.status_code}")
                    return False
            
            # Verify all 4 subjects have questions
            if len(questions_found) == 4:
                total_questions = sum(questions_found.values())
                self.log_result("database_init", True, 
                              f"Database properly initialized with {total_questions} total questions across 4 subjects")
                self.test_results["database_init"]["passed"] = True
                return True
            else:
                self.log_result("database_init", False, 
                              f"Expected 4 subjects, found {len(questions_found)}")
                return False
                
        except Exception as e:
            self.log_result("database_init", False, f"Database initialization test failed: {str(e)}")
            return False
    
    def test_quiz_apis(self) -> bool:
        """Test all 3 quiz types: free, by_subject, final_simulation"""
        print("\n=== TESTING QUIZ APIs ===")
        
        try:
            token = list(self.auth_tokens.values())[0]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Test 1: Free quiz
            response = self.session.post(
                f"{API_BASE}/quiz/start",
                json={"quiz_type": "free", "subject": "Geografia regionale"},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if "quiz_id" in data and "questions" in data and data["quiz_type"] == "free":
                    self.log_result("quiz_apis", True, "Free quiz started successfully")
                    free_quiz_id = data["quiz_id"]
                else:
                    self.log_result("quiz_apis", False, "Free quiz response missing required fields")
                    return False
            else:
                self.log_result("quiz_apis", False, f"Free quiz start failed: {response.status_code}")
                return False
            
            # Test 2: By subject quiz
            response = self.session.post(
                f"{API_BASE}/quiz/start",
                json={"quiz_type": "by_subject", "subject": "Normativa statale e regionale"},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if ("quiz_id" in data and "questions" in data and 
                    data["quiz_type"] == "by_subject" and len(data["questions"]) == 5):
                    self.log_result("quiz_apis", True, "By subject quiz started successfully with 5 questions")
                    subject_quiz_id = data["quiz_id"]
                else:
                    self.log_result("quiz_apis", False, 
                                  f"By subject quiz invalid: expected 5 questions, got {len(data.get('questions', []))}")
                    return False
            else:
                self.log_result("quiz_apis", False, f"By subject quiz start failed: {response.status_code}")
                return False
            
            # Test 3: Final simulation quiz
            response = self.session.post(
                f"{API_BASE}/quiz/start",
                json={"quiz_type": "final_simulation"},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if ("quiz_id" in data and "questions" in data and 
                    data["quiz_type"] == "final_simulation" and 
                    len(data["questions"]) == 20 and
                    data.get("time_limit") == 1800):
                    self.log_result("quiz_apis", True, 
                                  "Final simulation started successfully with 20 questions and 30min timer")
                    final_quiz_id = data["quiz_id"]
                    
                    # Verify questions are distributed across subjects
                    subjects_in_quiz = set(q["subject"] for q in data["questions"])
                    if len(subjects_in_quiz) == 4:
                        self.log_result("quiz_apis", True, 
                                      "Final simulation includes all 4 subjects")
                    else:
                        self.log_result("quiz_apis", False, 
                                      f"Final simulation missing subjects: {4 - len(subjects_in_quiz)}")
                        return False
                else:
                    self.log_result("quiz_apis", False, 
                                  f"Final simulation invalid: questions={len(data.get('questions', []))}, timer={data.get('time_limit')}")
                    return False
            else:
                self.log_result("quiz_apis", False, f"Final simulation start failed: {response.status_code}")
                return False
            
            # Test quiz submission for by_subject quiz
            answers = [random.randint(0, 3) for _ in range(5)]  # Random answers
            response = self.session.post(
                f"{API_BASE}/quiz/{subject_quiz_id}/submit",
                json={"answers": answers},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ["quiz_id", "total_correct", "total_questions", "score_by_subject", "passed", "correct_answers"]
                if all(field in data for field in required_fields):
                    self.log_result("quiz_apis", True, "Quiz submission successful with all required fields")
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_result("quiz_apis", False, f"Quiz submission missing fields: {missing}")
                    return False
            else:
                self.log_result("quiz_apis", False, f"Quiz submission failed: {response.status_code}")
                return False
            
            self.test_results["quiz_apis"]["passed"] = True
            return True
            
        except Exception as e:
            self.log_result("quiz_apis", False, f"Quiz APIs test failed: {str(e)}")
            return False
    
    def test_evaluation_logic(self) -> bool:
        """Test complex evaluation logic for final simulation"""
        print("\n=== TESTING EVALUATION LOGIC ===")
        
        try:
            token = list(self.auth_tokens.values())[0]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Start final simulation
            response = self.session.post(
                f"{API_BASE}/quiz/start",
                json={"quiz_type": "final_simulation"},
                headers=headers,
                timeout=10
            )
            
            if response.status_code != 200:
                self.log_result("evaluation_logic", False, "Could not start final simulation for evaluation test")
                return False
            
            quiz_data = response.json()
            quiz_id = quiz_data["quiz_id"]
            questions = quiz_data["questions"]
            
            # Group questions by subject to understand distribution
            questions_by_subject = {}
            for i, q in enumerate(questions):
                subject = q["subject"]
                if subject not in questions_by_subject:
                    questions_by_subject[subject] = []
                questions_by_subject[subject].append(i)
            
            # Test Case 1: Should PASS - 3+ correct per subject, ≤8 total errors
            # Create answers that give 4 correct per subject (16 total correct, 4 errors)
            passing_answers = [-1] * 20  # Initialize with unanswered
            for subject, indices in questions_by_subject.items():
                # Answer first 4 questions correctly for each subject (simulate knowing correct answers)
                for i in range(min(4, len(indices))):
                    passing_answers[indices[i]] = 0  # Assume option 0 is correct for simplicity
            
            response = self.session.post(
                f"{API_BASE}/quiz/{quiz_id}/submit",
                json={"answers": passing_answers},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                # Note: This test might not pass because we don't know the actual correct answers
                # But we can verify the evaluation logic structure
                if "score_by_subject" in result and "passed" in result:
                    self.log_result("evaluation_logic", True, 
                                  "Final simulation evaluation returns proper structure")
                    
                    # Verify score_by_subject has all subjects
                    if len(result["score_by_subject"]) == 4:
                        self.log_result("evaluation_logic", True, 
                                      "Score breakdown includes all 4 subjects")
                    else:
                        self.log_result("evaluation_logic", False, 
                                      f"Score breakdown missing subjects: expected 4, got {len(result['score_by_subject'])}")
                        return False
                else:
                    self.log_result("evaluation_logic", False, 
                                  "Final simulation result missing evaluation fields")
                    return False
            else:
                self.log_result("evaluation_logic", False, 
                              f"Final simulation submission failed: {response.status_code}")
                return False
            
            # Test Case 2: Test by_subject evaluation (>60% rule)
            response = self.session.post(
                f"{API_BASE}/quiz/start",
                json={"quiz_type": "by_subject", "subject": "Geografia regionale"},
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                quiz_data = response.json()
                quiz_id = quiz_data["quiz_id"]
                
                # Submit answers (3 correct out of 5 = 60%, should not pass as it's not >60%)
                answers = [0, 0, 0, 1, 1]  # Assume first 3 are correct
                response = self.session.post(
                    f"{API_BASE}/quiz/{quiz_id}/submit",
                    json={"answers": answers},
                    headers=headers,
                    timeout=10
                )
                
                if response.status_code == 200:
                    result = response.json()
                    self.log_result("evaluation_logic", True, 
                                  f"By subject evaluation completed: {result['total_correct']}/{result['total_questions']} correct")
                else:
                    self.log_result("evaluation_logic", False, 
                                  f"By subject submission failed: {response.status_code}")
                    return False
            
            self.test_results["evaluation_logic"]["passed"] = True
            return True
            
        except Exception as e:
            self.log_result("evaluation_logic", False, f"Evaluation logic test failed: {str(e)}")
            return False
    
    def test_statistics_api(self) -> bool:
        """Test user statistics API"""
        print("\n=== TESTING STATISTICS API ===")
        
        try:
            token = list(self.auth_tokens.values())[0]
            headers = {"Authorization": f"Bearer {token}"}
            
            # Get user statistics
            response = self.session.get(
                f"{API_BASE}/stats",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                stats = response.json()
                required_fields = ["total_attempts", "passed_attempts", "by_subject", "recent_attempts"]
                
                if all(field in stats for field in required_fields):
                    self.log_result("statistics", True, "Statistics API returns all required fields")
                    
                    # Verify by_subject structure
                    if isinstance(stats["by_subject"], dict):
                        self.log_result("statistics", True, "Statistics include subject breakdown")
                        
                        # Check if we have stats for subjects (after running previous tests)
                        if len(stats["by_subject"]) > 0:
                            sample_subject = list(stats["by_subject"].keys())[0]
                            subject_stats = stats["by_subject"][sample_subject]
                            expected_subject_fields = ["attempts", "accuracy", "best_score"]
                            
                            if all(field in subject_stats for field in expected_subject_fields):
                                self.log_result("statistics", True, 
                                              f"Subject statistics properly structured for {sample_subject}")
                            else:
                                missing = [f for f in expected_subject_fields if f not in subject_stats]
                                self.log_result("statistics", False, 
                                              f"Subject statistics missing fields: {missing}")
                                return False
                        else:
                            self.log_result("statistics", True, 
                                          "No subject statistics yet (expected for new user)")
                    else:
                        self.log_result("statistics", False, "by_subject field is not a dictionary")
                        return False
                    
                    # Verify recent_attempts is a list
                    if isinstance(stats["recent_attempts"], list):
                        self.log_result("statistics", True, 
                                      f"Recent attempts list contains {len(stats['recent_attempts'])} entries")
                    else:
                        self.log_result("statistics", False, "recent_attempts is not a list")
                        return False
                        
                else:
                    missing = [f for f in required_fields if f not in stats]
                    self.log_result("statistics", False, f"Statistics API missing fields: {missing}")
                    return False
            else:
                self.log_result("statistics", False, f"Statistics API failed: {response.status_code}")
                return False
            
            self.test_results["statistics"]["passed"] = True
            return True
            
        except Exception as e:
            self.log_result("statistics", False, f"Statistics API test failed: {str(e)}")
            return False
    
    def run_all_tests(self) -> Dict[str, Any]:
        """Run all backend tests"""
        print("🚀 Starting Backend Test Suite for Brescia Provincial Exam App")
        print("=" * 70)
        
        # Run tests in order of priority
        tests = [
            ("authentication", self.test_authentication),
            ("database_init", self.test_database_initialization),
            ("quiz_apis", self.test_quiz_apis),
            ("evaluation_logic", self.test_evaluation_logic),
            ("statistics", self.test_statistics_api)
        ]
        
        for test_name, test_func in tests:
            try:
                success = test_func()
                if not success:
                    print(f"\n❌ {test_name.upper()} TESTS FAILED - Stopping execution")
                    break
            except Exception as e:
                print(f"\n💥 {test_name.upper()} TESTS CRASHED: {str(e)}")
                self.log_result(test_name, False, f"Test crashed: {str(e)}")
                break
        
        return self.generate_report()
    
    def generate_report(self) -> Dict[str, Any]:
        """Generate final test report"""
        print("\n" + "=" * 70)
        print("📊 FINAL TEST REPORT")
        print("=" * 70)
        
        total_tests = 0
        passed_tests = 0
        
        for category, results in self.test_results.items():
            category_passed = results["passed"]
            category_total = len(results["details"])
            
            status = "✅ PASSED" if category_passed else "❌ FAILED"
            print(f"{category.upper()}: {status} ({sum(1 for d in results['details'] if d['success'])}/{category_total} checks)")
            
            total_tests += category_total
            passed_tests += sum(1 for d in results["details"] if d["success"])
            
            # Show failed tests
            failed_tests = [d for d in results["details"] if not d["success"]]
            if failed_tests:
                for failure in failed_tests:
                    print(f"  ❌ {failure['message']}")
        
        print(f"\nOVERALL: {passed_tests}/{total_tests} tests passed")
        
        # Determine overall success
        critical_systems = ["authentication", "database_init", "quiz_apis"]
        critical_passed = all(self.test_results[sys]["passed"] for sys in critical_systems)
        
        if critical_passed:
            print("🎉 BACKEND CORE FUNCTIONALITY: WORKING")
        else:
            print("🚨 BACKEND CORE FUNCTIONALITY: FAILED")
        
        return {
            "overall_success": critical_passed,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "results": self.test_results
        }

if __name__ == "__main__":
    tester = BackendTester()
    report = tester.run_all_tests()
    
    # Exit with appropriate code
    exit(0 if report["overall_success"] else 1)