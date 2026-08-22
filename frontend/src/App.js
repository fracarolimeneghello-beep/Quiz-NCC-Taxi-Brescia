import React, { useState, useEffect, useContext, createContext } from 'react';
import './App.css';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [token, setToken] = useState(localStorage.getItem('token'));

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  }, [token]);

  const login = async (username, password) => {
    try {
      const response = await axios.post(`${API}/auth/login`, { username, password });
      const { token: newToken, username: userName, is_admin } = response.data;
      const userData = { username: userName, is_admin: is_admin || false };
      setToken(newToken);
      setUser(userData);
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userData));
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  };

  const register = async (username, password) => {
    try {
      const response = await axios.post(`${API}/auth/register`, { username, password });
      const { token: newToken } = response.data;
      const userData = { username, is_admin: false };
      setToken(newToken);
      setUser(userData);
      localStorage.setItem('token', newToken);
      localStorage.setItem('user', JSON.stringify(userData));
      axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      return true;
    } catch (error) {
      console.error('Registration failed:', error);
      return false;
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
  };

  const changePassword = async (currentPassword, newPassword) => {
    try {
      await axios.post(`${API}/auth/change-password`, {
        username: user.username,
        current_password: currentPassword,
        new_password: newPassword
      });
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.detail || 'Errore durante il cambio password';
      return { success: false, message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
};

// Admin Panel Component
const AdminPanel = () => {
  const [questionCounts, setQuestionCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState({});
  const [selectedFiles, setSelectedFiles] = useState({});
  const { user } = useContext(AuthContext);

  const subjects = [
    "Geografia regionale",
    "Normativa statale e regionale", 
    "Normativa comunale TAXI e NCC",
    "Lingua Straniera"
  ];

  useEffect(() => {
    if (user?.is_admin) {
      fetchQuestionCounts();
    }
  }, [user]);

  const fetchQuestionCounts = async () => {
    try {
      const response = await axios.get(`${API}/admin/questions-count`);
      setQuestionCounts(response.data);
    } catch (error) {
      console.error('Error fetching question counts:', error);
    }
  };

  const handleFileSelect = (subject, file) => {
    setSelectedFiles(prev => ({
      ...prev,
      [subject]: file
    }));
  };

  const uploadQuestions = async (subject) => {
    if (!selectedFiles[subject]) {
      alert('Seleziona prima un file JSON');
      return;
    }

    setLoading(true);
    setUploadStatus(prev => ({
      ...prev,
      [subject]: { status: 'uploading', message: 'Caricamento in corso...' }
    }));

    try {
      const formData = new FormData();
      formData.append('subject', subject);
      formData.append('questions_file', selectedFiles[subject]);

      const response = await axios.post(`${API}/admin/upload-questions`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setUploadStatus(prev => ({
        ...prev,
        [subject]: { status: 'success', message: response.data.message }
      }));

      // Clear selected file
      setSelectedFiles(prev => ({
        ...prev,
        [subject]: null
      }));

      // Refresh counts
      await fetchQuestionCounts();

    } catch (error) {
      const errorMessage = error.response?.data?.detail || 'Errore durante il caricamento';
      setUploadStatus(prev => ({
        ...prev,
        [subject]: { status: 'error', message: errorMessage }
      }));
    } finally {
      setLoading(false);
    }
  };

  const resetToSampleQuestions = async () => {
    if (!confirm('Sei sicuro di voler ripristinare le domande di esempio? Questo cancellerà tutte le domande caricate.')) {
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API}/admin/reset-sample-questions`);
      alert(response.data.message);
      await fetchQuestionCounts();
      setUploadStatus({});
    } catch (error) {
      alert('Errore durante il ripristino delle domande di esempio');
    } finally {
      setLoading(false);
    }
  };

  const previewQuestions = async (subject) => {
    try {
      const response = await axios.get(`${API}/admin/preview-questions/${encodeURIComponent(subject)}`);
      
      let previewText = `ANTEPRIMA - ${subject}\nTotale domande: ${response.data.total_questions}\n\n`;
      
      response.data.preview.forEach((q, i) => {
        previewText += `${i + 1}. ${q.question_text}\n`;
        q.options.forEach((option, j) => {
          const marker = j === q.correct_answer ? '✓' : ' ';
          previewText += `   ${String.fromCharCode(65 + j)}) ${option} ${marker}\n`;
        });
        previewText += '\n';
      });

      alert(previewText);
    } catch (error) {
      alert('Errore nel caricamento dell\'anteprima');
    }
  };

  if (!user?.is_admin) {
    return <div className="text-center py-8">Accesso non autorizzato</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">
          🔧 Pannello di Amministrazione
        </h1>
        <p className="text-gray-600 mb-6">
          Carica i file JSON con le domande reali dell'esame per ogni argomento
        </p>

        {/* File Upload Instructions */}
        <div className="bg-blue-50 p-4 rounded-lg mb-6">
          <h3 className="font-semibold text-blue-800 mb-2">📋 Formato File JSON Richiesto:</h3>
          <pre className="text-sm text-blue-700 bg-blue-100 p-3 rounded overflow-x-auto">
{`[
  {
    "question_text": "Testo della domanda?",
    "options": ["Opzione A", "Opzione B", "Opzione C", "Opzione D"],
    "correct_answer": 1
  }
]`}
          </pre>
          <p className="text-sm text-blue-600 mt-2">
            • <code>correct_answer</code> è l'indice della risposta corretta (0-3)<br/>
            • Ogni file può contenere qualsiasi numero di domande<br/>
            • Le domande esistenti per l'argomento saranno sostituite
          </p>
        </div>

        {/* Current Questions Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {subjects.map((subject) => (
            <div key={subject} className="bg-gray-50 p-4 rounded-lg">
              <h4 className="font-medium text-gray-800 text-sm mb-2">{subject}</h4>
              <div className="text-2xl font-bold text-blue-600 mb-2">
                {questionCounts[subject] || 0} domande
              </div>
              <button
                onClick={() => previewQuestions(subject)}
                disabled={!questionCounts[subject]}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400"
              >
                👁 Anteprima
              </button>
            </div>
          ))}
        </div>

        {/* Upload Section */}
        <div className="space-y-6">
          {subjects.map((subject) => (
            <div key={subject} className="border border-gray-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">
                📚 {subject}
              </h3>

              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => handleFileSelect(subject, e.target.files[0])}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {selectedFiles[subject] && (
                    <p className="text-sm text-gray-600 mt-2">
                      File selezionato: {selectedFiles[subject].name}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => uploadQuestions(subject)}
                  disabled={loading || !selectedFiles[subject]}
                  className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Caricamento...' : 'Carica'}
                </button>
              </div>

              {/* Upload Status */}
              {uploadStatus[subject] && (
                <div className={`mt-4 p-3 rounded-lg ${
                  uploadStatus[subject].status === 'success' ? 'bg-green-100 text-green-800' :
                  uploadStatus[subject].status === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {uploadStatus[subject].message}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Reset to Sample Questions */}
        <div className="mt-8 p-6 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">
            🔄 Ripristina Domande di Esempio
          </h3>
          <p className="text-yellow-700 mb-4">
            Questo ripristinerà le domande di esempio originali per tutti gli argomenti. 
            Tutte le domande caricate saranno eliminate.
          </p>
          <button
            onClick={resetToSampleQuestions}
            disabled={loading}
            className="bg-yellow-600 text-white px-6 py-2 rounded-lg hover:bg-yellow-700 disabled:opacity-50 transition-colors"
          >
            Ripristina Domande di Esempio
          </button>
        </div>
      </div>
    </div>
  );
};

// Login Component
const LoginPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login, register } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const success = isLogin ? await login(username, password) : await register(username, password);
    
    if (!success) {
      setError(isLogin ? 'Login fallito. Controlla le credenziali.' : 'Registrazione fallita.');
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-600 to-purple-700 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Esame Provinciale Brescia
          </h1>
          <p className="text-gray-600">
            Preparazione per conducenti di servizi pubblici non di linea
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-200 disabled:opacity-50 font-medium transition-colors"
          >
            {loading ? 'Caricamento...' : (isLogin ? 'Accedi' : 'Registrati')}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            {isLogin ? 'Non hai un account? Registrati' : 'Hai già un account? Accedi'}
          </button>
        </div>

        {/* Logo Autoscuola */}
        <div className="mt-6 text-center">
          <img
            src="/logo-autoscuola.png"
            alt="Autoscuola Desenzanese"
            className="mx-auto h-16 object-contain"
          />
        </div>
      </div>
    </div>
  );
};

// Main Dashboard
const ChangePasswordModal = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const { changePassword } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Le due password non coincidono');
      return;
    }
    if (newPassword.length < 6) {
      setError('La nuova password deve avere almeno 6 caratteri');
      return;
    }

    setLoading(true);
    const result = await changePassword(currentPassword, newPassword);
    setLoading(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold text-gray-900">Cambia Password</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {success ? (
          <div className="text-green-600 font-medium py-4 text-center">
            Password aggiornata con successo!
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password attuale</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nuova password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Conferma nuova password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <div className="text-red-600 text-sm">{error}</div>}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const { user, logout } = useContext(AuthContext);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <img
                src="/logo-autoscuola.png"
                alt="Autoscuola Desenzanese"
                className="h-10 object-contain"
              />
              <h1 className="text-2xl font-bold text-gray-900">
                Esame Provinciale Brescia
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-600">
                Benvenuto, {user?.username} {user?.is_admin && '👑'}
              </span>
              <button
                onClick={() => setShowChangePassword(true)}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cambia Password
              </button>
              <button
                onClick={logout}
                className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>

      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Admin Panel Access */}
        {user?.is_admin && (
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-xl mb-8">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold mb-2">👑 Pannello Amministratore</h2>
                <p className="opacity-90">Carica e gestisci le domande dell'esame</p>
              </div>
              <button
                onClick={() => {
                  window.location.hash = '#admin';
                  window.location.reload();
                }}
                className="bg-white text-purple-600 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors"
              >
                Gestisci Domande 🔧
              </button>
            </div>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Tentativi Totali</h3>
            <p className="text-3xl font-bold text-blue-600">{stats?.total_attempts || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Esami Superati</h3>
            <p className="text-3xl font-bold text-green-600">{stats?.passed_attempts || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Tasso di Successo</h3>
            <p className="text-3xl font-bold text-purple-600">
              {stats?.total_attempts > 0 ? Math.round((stats.passed_attempts / stats.total_attempts) * 100) : 0}%
            </p>
          </div>
        </div>

        {/* Subject Stats */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Statistiche per Argomento</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(stats?.by_subject || {}).map(([subject, data]) => (
              <div key={subject} className="p-4 bg-gray-50 rounded-lg">
                <h3 className="font-medium text-gray-800 text-sm mb-2">{subject}</h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Tentativi:</span>
                    <span className="font-medium">{data.attempts}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Precisione:</span>
                    <span className="font-medium">{Math.round(data.accuracy)}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Miglior Score:</span>
                    <span className="font-medium">{Math.round(data.best_score)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quiz Modes */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <QuizModeCard
            title="Prova Libera"
            description="Tutte le domande di un singolo argomento"
            icon="📚"
            type="free"
          />
          <QuizModeCard
            title="Prova per Argomento"
            description="5 domande casuali da un argomento"
            icon="🎯"
            type="by_subject"
          />
          <QuizModeCard
            title="Simulazione Finale"
            description="5 domande per ogni argomento - 30 minuti"
            icon="⏰"
            type="final_simulation"
          />
        </div>
      </div>
    </div>
  );
};

// Quiz Mode Card Component
const QuizModeCard = ({ title, description, icon, type }) => {
  const [showSubjects, setShowSubjects] = useState(false);

  const subjects = [
    "Geografia regionale",
    "Normativa statale e regionale",
    "Normativa comunale TAXI e NCC",
    "Lingua Straniera"
  ];

  const startQuiz = async (subject = null) => {
    try {
      const quizData = { quiz_type: type };
      if (subject) quizData.subject = subject;

      const response = await axios.post(`${API}/quiz/start`, quizData);
      
      // Store quiz data and redirect to quiz
      localStorage.setItem('currentQuiz', JSON.stringify({
        ...response.data,
        quiz_type: type
      }));
      
      window.location.hash = '#quiz';
      window.location.reload();
    } catch (error) {
      console.error('Error starting quiz:', error);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <div className="text-center mb-4">
        <div className="text-4xl mb-2">{icon}</div>
        <h3 className="text-xl font-bold text-gray-800 mb-2">{title}</h3>
        <p className="text-gray-600 text-sm">{description}</p>
      </div>

      {type === 'final_simulation' ? (
        <button
          onClick={() => startQuiz()}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all duration-200 font-medium"
        >
          Inizia Simulazione
        </button>
      ) : (
        <>
          <button
            onClick={() => setShowSubjects(!showSubjects)}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Scegli Argomento
          </button>

          {showSubjects && (
            <div className="mt-4 space-y-2">
              {subjects.map((subject) => (
                <button
                  key={subject}
                  onClick={() => startQuiz(subject)}
                  className="w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                >
                  {subject}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Quiz Component
const Quiz = () => {
  const [quizData, setQuizData] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    const storedQuiz = localStorage.getItem('currentQuiz');
    if (storedQuiz) {
      const quiz = JSON.parse(storedQuiz);
      setQuizData(quiz);
      setAnswers(new Array(quiz.questions.length).fill(-1));
      
      if (quiz.time_limit) {
        setTimeLeft(quiz.time_limit);
      }
    }
  }, []);

  useEffect(() => {
    if (timeLeft && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (timeLeft === 0 && !submitted) {
      handleSubmit();
    }
  }, [timeLeft]);

  const handleAnswerSelect = (answerIndex) => {
    const newAnswers = [...answers];
    newAnswers[currentQuestionIndex] = answerIndex;
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    try {
      const response = await axios.post(`${API}/quiz/${quizData.quiz_id}/submit`, {
        answers: answers
      });
      
      setResults(response.data);
      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting quiz:', error);
    }
  };

  const goToDashboard = () => {
    localStorage.removeItem('currentQuiz');
    window.location.hash = '';
    window.location.reload();
  };

  if (!quizData) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-xl">Caricamento quiz...</div>
    </div>;
  }

  if (submitted && results) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className={`text-6xl mb-4 ${results.passed ? 'text-green-500' : 'text-red-500'}`}>
              {results.passed ? '✅' : '❌'}
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-2">
              {results.passed ? 'Esame Superato!' : 'Esame Non Superato'}
            </h2>
            <p className="text-gray-600">
              Hai risposto correttamente a {results.total_correct} su {results.total_questions} domande
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {Object.entries(results.score_by_subject).map(([subject, score]) => (
              <div key={subject} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-800">{subject}</span>
                  <span className="text-lg font-bold">
                    {score.correct}/{score.total}
                  </span>
                </div>
                <div className="mt-2 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      score.correct >= 3 ? 'bg-green-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${(score.correct / score.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={goToDashboard}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Torna alla Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = quizData.questions[currentQuestionIndex];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800">
              {quizData.quiz_type === 'final_simulation' ? 'Simulazione Finale' : 
               quizData.quiz_type === 'free' ? 'Prova Libera' : 'Prova per Argomento'}
            </h1>
            {timeLeft && (
              <div className="text-xl font-bold text-red-600">
                ⏰ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-gray-600">
              Domanda {currentQuestionIndex + 1} di {quizData.questions.length}
            </span>
            <span className="text-gray-600">
              {currentQuestion.subject}
            </span>
          </div>
          
          <div className="mt-4 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${((currentQuestionIndex + 1) / quizData.questions.length) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Question */}
        <div className="bg-white rounded-xl shadow-sm border p-8 mb-6">
          <h2 className="text-xl font-medium text-gray-800 mb-6">
            {currentQuestion.question_text}
          </h2>
          
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleAnswerSelect(index)}
                className={`w-full p-4 text-left rounded-lg border transition-colors ${
                  answers[currentQuestionIndex] === index
                    ? 'bg-blue-100 border-blue-500 text-blue-800'
                    : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <span className="font-medium">{String.fromCharCode(65 + index)})</span> {option}
              </button>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ← Precedente
          </button>
          
          {currentQuestionIndex === quizData.questions.length - 1 ? (
            <button
              onClick={handleSubmit}
              className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              Termina Quiz
            </button>
          ) : (
            <button
              onClick={() => setCurrentQuestionIndex(Math.min(quizData.questions.length - 1, currentQuestionIndex + 1))}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Successiva →
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Main App Component
function App() {
  const [currentView, setCurrentView] = useState('dashboard');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#quiz') {
      setCurrentView('quiz');
    } else if (hash === '#admin') {
      setCurrentView('admin');
    }
  }, []);

  return (
    <AuthProvider>
      <AuthContext.Consumer>
        {({ token, user }) => {
          if (!token) {
            return <LoginPage />;
          }

          if (currentView === 'quiz') {
            return <Quiz />;
          }

          if (currentView === 'admin' && user?.is_admin) {
            return <AdminPanel />;
          }

          return <Dashboard />;
        }}
      </AuthContext.Consumer>
    </AuthProvider>
  );
}

export default App;
