import React, { useState, useEffect, useContext, createContext, useRef } from 'react';
import './App.css';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// If any request comes back unauthenticated (session expired, password
// changed elsewhere, or — most commonly here — someone else logged into
// this same account from another device), clear the stale session and
// send the person back to the login screen with a clear explanation,
// instead of leaving them stuck on a page that silently stops working.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && localStorage.getItem('token')) {
      const detail = error.response?.data?.detail;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (detail) {
        localStorage.setItem('authNotice', detail);
      }
      window.location.hash = '';
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

// Auth Context
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [token, setToken] = useState(() => {
    const storedToken = localStorage.getItem('token');
    // Set the Authorization header immediately (synchronously), before any
    // child component's effects run, to avoid a race condition where a
    // request (like fetching stats) fires before the header is attached.
    if (storedToken) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
    }
    return storedToken;
  });

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
      return { success: true };
    } catch (error) {
      console.error('Login failed:', error);
      return { success: false, message: error.response?.data?.detail };
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
      const response = await axios.post(`${API}/auth/change-password`, {
        current_password: currentPassword,
        new_password: newPassword
      });
      // Changing the password invalidates the previous session token on the
      // server, which issues a fresh one for this browser tab — save it,
      // or the very next request would get rejected as unauthenticated.
      const newToken = response.data.token;
      if (newToken) {
        setToken(newToken);
        localStorage.setItem('token', newToken);
        axios.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
      }
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.detail || 'Errore durante il cambio password';
      return { success: false, message };
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, changePassword }}>
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
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [newStudent, setNewStudent] = useState({ username: '', password: '', months: 6 });
  const [studentError, setStudentError] = useState('');
  const [extendMonths, setExtendMonths] = useState({});
  const [poiCounts, setPoiCounts] = useState({ city: 0, province: 0 });
  const [poiFiles, setPoiFiles] = useState({});
  const [poiUploadStatus, setPoiUploadStatus] = useState({});
  const { user } = useContext(AuthContext);

  const subjects = [
    "Geografia regionale",
    "Normativa statale e regionale",
    "Normativa comunale TAXI e NCC",
    "Lingua Straniera - Inglese",
    "Lingua Straniera - Francese",
    "Lingua Straniera - Spagnolo",
    "Lingua Straniera - Tedesco"
  ];

  useEffect(() => {
    if (user?.is_admin) {
      fetchQuestionCounts();
      fetchStudents();
      fetchPoiCounts();
    }
  }, [user]);

  const fetchPoiCounts = async () => {
    try {
      const response = await axios.get(`${API}/admin/poi-count`);
      setPoiCounts(response.data);
    } catch (error) {
      console.error('Error fetching POI counts:', error);
    }
  };

  const uploadPoi = async (poiType) => {
    const file = poiFiles[poiType];
    if (!file) return;
    setPoiUploadStatus(prev => ({ ...prev, [poiType]: { status: 'loading', message: 'Caricamento...' } }));
    const formData = new FormData();
    formData.append('poi_type', poiType);
    formData.append('poi_file', file);
    try {
      const response = await axios.post(`${API}/admin/upload-poi`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPoiUploadStatus(prev => ({ ...prev, [poiType]: { status: 'success', message: response.data.message } }));
      fetchPoiCounts();
    } catch (error) {
      setPoiUploadStatus(prev => ({ ...prev, [poiType]: { status: 'error', message: error.response?.data?.detail || 'Errore durante il caricamento' } }));
    }
  };

  const fetchStudents = async () => {
    setStudentsLoading(true);
    try {
      const response = await axios.get(`${API}/admin/students`);
      setStudents(response.data);
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setStudentsLoading(false);
    }
  };

  const createStudent = async (e) => {
    e.preventDefault();
    setStudentError('');
    try {
      await axios.post(`${API}/admin/students`, newStudent);
      setNewStudent({ username: '', password: '', months: 6 });
      fetchStudents();
    } catch (error) {
      setStudentError(error.response?.data?.detail || 'Errore durante la creazione dello studente');
    }
  };

  const extendStudent = async (studentId) => {
    const months = extendMonths[studentId] || 6;
    try {
      await axios.post(`${API}/admin/students/${studentId}/extend`, { months: Number(months) });
      fetchStudents();
    } catch (error) {
      console.error('Error extending student:', error);
    }
  };

  const revokeStudent = async (studentId, username) => {
    if (!window.confirm(`Revocare l'accesso di "${username}"? L'account verrà eliminato definitivamente.`)) return;
    try {
      await axios.delete(`${API}/admin/students/${studentId}`);
      fetchStudents();
    } catch (error) {
      console.error('Error revoking student:', error);
    }
  };

  const resetStudentPassword = async (studentId, username) => {
    if (!window.confirm(`Generare una nuova password temporanea per "${username}"?`)) return;
    try {
      const response = await axios.post(`${API}/admin/students/${studentId}/reset-password`);
      window.alert(`Nuova password per ${response.data.username}:\n\n${response.data.new_password}\n\nComunicala allo studente. Non verrà mostrata di nuovo.`);
    } catch (error) {
      console.error('Error resetting password:', error);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

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
      <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-8">
        <div className="flex justify-between items-start mb-2">
          <h1 className="font-display text-2xl font-semibold text-navy-900">
            🔧 Pannello di Amministrazione
          </h1>
          <button
            onClick={() => {
              window.location.hash = '';
              window.location.reload();
            }}
            className="bg-paper text-navy-900 px-4 py-2 rounded-lg hover:bg-navy-50 transition-colors text-sm font-medium whitespace-nowrap"
          >
            ← Torna alla Dashboard
          </button>
        </div>
        <p className="text-navy-400 mb-6">
          Carica i file JSON con le domande reali dell'esame per ogni argomento
        </p>

        {/* File Upload Instructions */}
        <div className="bg-navy-50 p-4 rounded-lg mb-6">
          <h3 className="font-semibold text-navy-900 mb-2">📋 Formato File JSON Richiesto:</h3>
          <pre className="text-sm text-navy-700 bg-white p-3 rounded overflow-x-auto border border-navy-100">
{`[
  {
    "question_text": "Testo della domanda?",
    "options": ["Opzione A", "Opzione B", "Opzione C", "Opzione D"],
    "correct_answer": 1
  }
]`}
          </pre>
          <p className="text-sm text-navy-600 mt-2">
            • <code>correct_answer</code> è l'indice della risposta corretta (0-3)<br/>
            • Ogni file può contenere qualsiasi numero di domande<br/>
            • Le domande esistenti per l'argomento saranno sostituite
          </p>
        </div>

        {/* Current Questions Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {subjects.map((subject) => (
            <div key={subject} className="bg-paper p-4 rounded-lg border border-navy-50">
              <h4 className="font-medium text-navy-900 text-sm mb-2">{subject}</h4>
              <div className="font-mono text-2xl font-semibold text-navy-900 mb-2">
                {questionCounts[subject] || 0} domande
              </div>
              <button
                onClick={() => previewQuestions(subject)}
                disabled={!questionCounts[subject]}
                className="text-sm text-navy-600 hover:text-navy-900 disabled:text-navy-100"
              >
                👁 Anteprima
              </button>
            </div>
          ))}
        </div>

        {/* Student Accounts */}
        <div className="border border-navy-200 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold text-navy-900 mb-1">🎓 Studenti</h3>
          <p className="text-navy-400 text-sm mb-4">
            Crea un account per ogni studente. La registrazione pubblica è disattivata: l'accesso arriva solo da qui.
          </p>

          <form onSubmit={createStudent} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <input
              type="text"
              placeholder="Username"
              value={newStudent.username}
              onChange={(e) => setNewStudent({ ...newStudent, username: e.target.value })}
              required
              className="bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white"
            />
            <input
              type="text"
              placeholder="Password"
              value={newStudent.password}
              onChange={(e) => setNewStudent({ ...newStudent, password: e.target.value })}
              required
              minLength={6}
              className="bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white"
            />
            <input
              type="number"
              min="1"
              max="60"
              value={newStudent.months}
              onChange={(e) => setNewStudent({ ...newStudent, months: e.target.value })}
              className="bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white"
              title="Durata in mesi"
            />
            <button
              type="submit"
              className="bg-navy-900 text-white px-4 py-2 rounded-lg hover:bg-navy-700 transition-colors text-sm font-medium"
            >
              Crea Studente
            </button>
          </form>
          {studentError && <div className="text-brick-500 text-sm mb-4">{studentError}</div>}

          {studentsLoading ? (
            <p className="text-navy-400 text-sm">Caricamento...</p>
          ) : students.length === 0 ? (
            <p className="text-navy-400 text-sm">Nessuno studente ancora creato.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-navy-400 border-b border-navy-100">
                    <th className="py-2 pr-4">Username</th>
                    <th className="py-2 pr-4">Scadenza</th>
                    <th className="py-2 pr-4">Stato</th>
                    <th className="py-2 pr-4">Estendi</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id} className="border-b border-navy-50">
                      <td className="py-2 pr-4 font-medium text-navy-900">{s.username}</td>
                      <td className="py-2 pr-4 font-mono text-navy-900">{formatDate(s.expires_at)}</td>
                      <td className="py-2 pr-4">
                        {s.expired ? (
                          <span className="text-brick-500 font-medium">Scaduto</span>
                        ) : (
                          <span className="text-leaf-600 font-medium">Attivo</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1"
                            max="60"
                            placeholder="mesi"
                            value={extendMonths[s.id] ?? ''}
                            onChange={(e) => setExtendMonths({ ...extendMonths, [s.id]: e.target.value })}
                            className="w-16 bg-paper border border-navy-200 rounded px-2 py-1 text-xs"
                          />
                          <button
                            onClick={() => extendStudent(s.id)}
                            className="text-navy-600 hover:text-navy-900 text-xs font-medium"
                          >
                            Estendi
                          </button>
                        </div>
                      </td>
                      <td className="py-2">
                        <div className="flex gap-3">
                          <button
                            onClick={() => resetStudentPassword(s.id, s.username)}
                            className="text-navy-600 hover:text-navy-900 text-xs font-medium"
                          >
                            Reset Password
                          </button>
                          <button
                            onClick={() => revokeStudent(s.id, s.username)}
                            className="text-brick-500 hover:text-brick-600 text-xs font-medium"
                          >
                            Revoca
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* POI Management (Prova Orale) */}
        <div className="border border-navy-200 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold text-navy-900 mb-1">🗺️ Punti Prova Orale</h3>
          <p className="text-navy-400 text-sm mb-4">
            Carica i punti (JSON) usati nella Prova Orale — città e provincia. Ogni caricamento sostituisce l'elenco precedente per quella categoria.
          </p>

          <div className="bg-navy-50 p-4 rounded-lg mb-4">
            <pre className="text-xs text-navy-700 bg-white p-3 rounded overflow-x-auto border border-navy-100">
{`[
  { "name": "Piazza della Loggia", "category": "monumento", "lat": 45.5398, "lng": 10.2199 }
]`}
            </pre>
          </div>

          {[
            { key: 'city', label: 'Punti Città (attualmente: ' + poiCounts.city + ')' },
            { key: 'province', label: 'Punti Provincia (attualmente: ' + poiCounts.province + ')' },
          ].map(({ key, label }) => (
            <div key={key} className="mb-4">
              <p className="text-sm font-medium text-navy-900 mb-2">{label}</p>
              <div className="flex flex-col sm:flex-row gap-3 items-start">
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => setPoiFiles(prev => ({ ...prev, [key]: e.target.files[0] }))}
                  className="block text-sm text-navy-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-navy-50 file:text-navy-900 hover:file:bg-navy-100"
                />
                <button
                  onClick={() => uploadPoi(key)}
                  disabled={!poiFiles[key]}
                  className="bg-navy-900 text-white px-6 py-2 rounded-lg hover:bg-navy-700 disabled:opacity-50 transition-colors text-sm"
                >
                  Carica
                </button>
              </div>
              {poiUploadStatus[key] && (
                <div className={`mt-2 p-2 rounded text-sm ${
                  poiUploadStatus[key].status === 'success' ? 'bg-leaf-50 text-leaf-600' :
                  poiUploadStatus[key].status === 'error' ? 'bg-brick-50 text-brick-600' :
                  'bg-navy-50 text-navy-900'
                }`}>
                  {poiUploadStatus[key].message}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Upload Section */}
        <div className="space-y-6">
          {subjects.map((subject) => (
            <div key={subject} className="border border-navy-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-navy-900 mb-4">
                📚 {subject}
              </h3>

              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <div className="flex-1">
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => handleFileSelect(subject, e.target.files[0])}
                    className="block w-full text-sm text-navy-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-navy-50 file:text-navy-900 hover:file:bg-navy-100"
                  />
                  {selectedFiles[subject] && (
                    <p className="text-sm text-navy-400 mt-2">
                      File selezionato: {selectedFiles[subject].name}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => uploadQuestions(subject)}
                  disabled={loading || !selectedFiles[subject]}
                  className="bg-navy-900 text-white px-6 py-2 rounded-lg hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Caricamento...' : 'Carica'}
                </button>
              </div>

              {/* Upload Status */}
              {uploadStatus[subject] && (
                <div className={`mt-4 p-3 rounded-lg ${
                  uploadStatus[subject].status === 'success' ? 'bg-leaf-50 text-leaf-600' :
                  uploadStatus[subject].status === 'error' ? 'bg-brick-50 text-brick-600' :
                  'bg-navy-50 text-navy-900'
                }`}>
                  {uploadStatus[subject].message}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Reset to Sample Questions */}
        <div className="mt-8 p-6 bg-brick-50 border border-brick-500/20 rounded-lg">
          <h3 className="text-lg font-semibold text-brick-600 mb-2">
            🔄 Ripristina Domande di Esempio
          </h3>
          <p className="text-brick-600 mb-4 opacity-90">
            Questo ripristinerà le domande di esempio originali per tutti gli argomenti. 
            Tutte le domande caricate saranno eliminate.
          </p>
          <button
            onClick={resetToSampleQuestions}
            disabled={loading}
            className="bg-brick-500 text-white px-6 py-2 rounded-lg hover:bg-brick-600 disabled:opacity-50 transition-colors"
          >
            Ripristina Domande di Esempio
          </button>
        </div>
      </div>
    </div>
  );
};

// Toggle between the two login background options: a photographic hero
// shot, or the bespoke SVG skyline illustration. Change this one line to
// compare them live.
const LOGIN_BACKGROUND = 'photo'; // 'photo' | 'illustration'

const SkylineArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 680 380" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#0B1626" />
        <stop offset="55%" stopColor="#1D2A46" />
        <stop offset="100%" stopColor="#3A1B2E" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="680" height="380" fill="url(#skyGrad)" />
    <circle cx="560" cy="70" r="65" fill="#F3E9D2" opacity="0.05" />
    <circle cx="560" cy="70" r="45" fill="#F3E9D2" opacity="0.09" />
    <circle cx="560" cy="70" r="24" fill="#F3E9D2" opacity="0.85" />
    <circle cx="80" cy="45" r="1.4" fill="#F3E9D2" opacity="0.7" />
    <circle cx="140" cy="80" r="1.2" fill="#F3E9D2" opacity="0.5" />
    <circle cx="200" cy="35" r="1.6" fill="#F3E9D2" opacity="0.8" />
    <circle cx="260" cy="60" r="1.2" fill="#F3E9D2" opacity="0.6" />
    <circle cx="320" cy="30" r="1.4" fill="#F3E9D2" opacity="0.7" />
    <circle cx="30" cy="100" r="1.2" fill="#F3E9D2" opacity="0.5" />
    <circle cx="410" cy="50" r="1.5" fill="#F3E9D2" opacity="0.75" />
    <circle cx="470" cy="90" r="1.2" fill="#F3E9D2" opacity="0.5" />
    <circle cx="630" cy="130" r="1.3" fill="#F3E9D2" opacity="0.6" />
    <g fill="#1D3A66" opacity="0.55">
      <rect x="0" y="190" width="60" height="70" />
      <rect x="55" y="160" width="40" height="100" />
      <rect x="90" y="200" width="50" height="60" />
      <rect x="135" y="170" width="35" height="90" />
      <rect x="165" y="210" width="55" height="50" />
      <rect x="215" y="180" width="45" height="80" />
      <rect x="395" y="205" width="50" height="55" />
      <rect x="440" y="175" width="65" height="85" />
      <rect x="500" y="200" width="45" height="60" />
      <rect x="590" y="190" width="50" height="70" />
    </g>
    <g fill="#0B1626">
      <rect x="0" y="220" width="80" height="80" />
      <rect x="70" y="210" width="50" height="90" />
      <rect x="195" y="190" width="55" height="110" />
      <rect x="260" y="220" width="45" height="80" />
      <rect x="315" y="170" width="60" height="130" />
      <rect x="390" y="205" width="50" height="95" />
      <rect x="455" y="185" width="65" height="115" />
      <rect x="535" y="215" width="50" height="85" />
      <rect x="600" y="155" width="75" height="145" />
    </g>
    <g>
      <rect x="140" y="130" width="40" height="170" fill="#0B1626" />
      <path d="M140,130 L160,100 L180,130 Z" fill="#0B1626" />
      <circle cx="160" cy="93" r="3.5" fill="#0B1626" />
    </g>
    <g fill="#F3E9D2" opacity="0.75">
      <rect x="14" y="235" width="6" height="8" />
      <rect x="80" y="230" width="6" height="8" />
      <rect x="205" y="210" width="6" height="8" />
      <rect x="330" y="195" width="6" height="8" />
      <rect x="345" y="215" width="6" height="8" />
      <rect x="470" y="205" width="6" height="8" />
      <rect x="550" y="235" width="6" height="8" />
      <rect x="615" y="180" width="6" height="8" />
      <rect x="625" y="210" width="6" height="8" />
    </g>
    <g fill="#D6273C" opacity="0.6">
      <rect x="152" y="150" width="6" height="8" />
      <rect x="620" y="240" width="6" height="8" />
      <rect x="90" y="245" width="6" height="8" />
    </g>
    <rect x="0" y="292" width="680" height="10" fill="#D6273C" opacity="0.07" />
    <path d="M310,300 L370,300 L680,380 L0,380 Z" fill="#12233F" />
    <g fill="#F3E9D2" opacity="0.85">
      <polygon points="337,306 343,306 344,312 336,312" />
      <polygon points="333,325 347,325 349,335 331,335" />
      <polygon points="327,352 353,352 357,366 323,366" />
    </g>
    <ellipse cx="486" cy="352" rx="55" ry="10" fill="#D6273C" opacity="0.1" />
    <line x1="390" y1="344" x2="418" y2="344" stroke="#D6273C" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
    <line x1="365" y1="347" x2="415" y2="347" stroke="#D6273C" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
    <line x1="345" y1="350" x2="412" y2="350" stroke="#D6273C" strokeWidth="2" strokeLinecap="round" opacity="0.25" />
    <path d="M552,338 L612,323 L612,357 Z" fill="#F3E9D2" opacity="0.12" />
    <circle cx="440" cy="352" r="9" fill="#0B1626" stroke="#F3E9D2" strokeWidth="1" opacity="0.9" />
    <circle cx="440" cy="352" r="3" fill="#3A1B2E" />
    <circle cx="520" cy="352" r="9" fill="#0B1626" stroke="#F3E9D2" strokeWidth="1" opacity="0.9" />
    <circle cx="520" cy="352" r="3" fill="#3A1B2E" />
    <path d="M420,350 L430,335 L450,330 L470,330 L480,320 L510,320 L520,330 L545,332 L552,345 L552,352 L420,352 Z" fill="#12233F" />
    <path d="M450,330 L470,330 L466,340 L448,340 Z" fill="#1D3A66" opacity="0.6" />
    <rect x="470" y="311" width="18" height="9" rx="2" fill="#D6273C" />
    <rect x="466" y="308" width="26" height="15" rx="3" fill="#D6273C" opacity="0.18" />
  </svg>
);

// Login Component
const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() => {
    const notice = localStorage.getItem('authNotice');
    if (notice) localStorage.removeItem('authNotice');
    return notice || '';
  });
  const { login } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const result = await login(username, password);
    
    if (!result.success) {
      setError(result.message || 'Login fallito. Controlla le credenziali.');
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-navy-900 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background: photo or illustration, chosen via LOGIN_BACKGROUND above */}
      {LOGIN_BACKGROUND === 'photo' ? (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'url(/login-bg.jpg)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(1.25) saturate(1.05)',
            }}
          ></div>
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(180deg, rgba(11,22,38,0.15) 0%, rgba(11,22,38,0.5) 100%)',
            }}
          ></div>
        </>
      ) : (
        <SkylineArt />
      )}


      <div className="max-w-md w-full relative">
        <div className="text-center mb-6">
          <img
            src="/logo-autoscuola.png"
            alt="Autoscuola Desenzanese"
            className="mx-auto h-20 object-contain mb-4 bg-white rounded-xl p-3"
          />
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="font-display text-3xl font-semibold text-navy-900 mb-2">
              Esame Provinciale Brescia
            </h1>
            <p className="text-navy-400 text-sm">
              Preparazione per conducenti di servizi pubblici non di linea
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-navy-900 mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-paper border border-navy-200 rounded-lg focus:ring-2 focus:ring-navy-600 focus:border-transparent focus:bg-white outline-none transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-navy-900 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-paper border border-navy-200 rounded-lg focus:ring-2 focus:ring-navy-600 focus:border-transparent focus:bg-white outline-none transition-colors"
                required
              />
            </div>

            {error && (
              <div className="text-brick-500 text-sm text-center font-medium">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-navy-900 text-white py-3 px-4 rounded-lg hover:bg-navy-700 focus:ring-4 focus:ring-navy-100 disabled:opacity-50 font-medium transition-colors"
            >
              {loading ? 'Caricamento...' : 'Accedi'}
            </button>
          </form>

          <p className="text-center text-xs text-navy-400 mt-6">
            Le credenziali vengono fornite dalla scuola guida. Se non le hai ancora ricevute, contatta la segreteria.
          </p>
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
    <div className="fixed inset-0 bg-navy-900 bg-opacity-60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-display text-xl font-semibold text-navy-900">Cambia Password</h3>
          <button onClick={onClose} className="text-navy-400 hover:text-navy-900 text-2xl leading-none">&times;</button>
        </div>

        {success ? (
          <div className="text-leaf-500 font-medium py-4 text-center">
            Password aggiornata con successo!
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-navy-900 mb-1">Password attuale</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-900 mb-1">Nuova password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-navy-900 mb-1">Conferma nuova password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-navy-600 focus:bg-white transition-colors"
              />
            </div>

            {error && <div className="text-brick-500 text-sm">{error}</div>}

            <div className="flex space-x-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-paper text-navy-900 px-4 py-2 rounded-lg hover:bg-navy-50 transition-colors"
              >
                Annulla
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-navy-900 text-white px-4 py-2 rounded-lg hover:bg-navy-700 transition-colors disabled:opacity-50"
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

// Speedometer-style gauge, used for the pass-rate stat — a nod to the
// dashboard of the vehicles our candidates will be driving professionally.
const SuccessGauge = ({ percentage }) => {
  const radius = 80;
  const circumference = Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, percentage)) / 100) * circumference;
  const color = percentage >= 60 ? '#1E8E5A' : percentage > 0 ? '#D6273C' : '#D6DDE9';

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 100" className="w-40 h-24">
        <path d="M 10 90 A 80 80 0 0 1 170 90" fill="none" stroke="#EEF1F6" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M 10 90 A 80 80 0 0 1 170 90"
          fill="none"
          stroke={color}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <span className="font-mono text-3xl font-semibold text-navy-900 -mt-6">{percentage}%</span>
    </div>
  );
};

// Line chart of score percentage over the last attempts, with a dashed
// reference line at the 60% pass threshold.
const ProgressChart = ({ history }) => {
  if (!history || history.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-navy-400 text-sm">
        Fai qualche quiz per vedere qui il tuo andamento
      </div>
    );
  }

  const width = 640;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 24, left: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const n = history.length;
  const xFor = (i) => padding.left + (n === 1 ? chartWidth / 2 : (i / (n - 1)) * chartWidth);
  const yFor = (pct) => padding.top + chartHeight - (Math.min(100, Math.max(0, pct)) / 100) * chartHeight;

  const linePoints = history.map((h, i) => `${xFor(i)},${yFor(h.percentage)}`).join(' ');
  const areaPoints = `${xFor(0)},${padding.top + chartHeight} ${linePoints} ${xFor(n - 1)},${padding.top + chartHeight}`;
  const thresholdY = yFor(60);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
      {/* Horizontal gridlines at 0/50/100% */}
      {[0, 50, 100].map((pct) => (
        <g key={pct}>
          <line x1={padding.left} y1={yFor(pct)} x2={width - padding.right} y2={yFor(pct)} stroke="#EEF1F6" strokeWidth="1" />
          <text x={padding.left - 8} y={yFor(pct) + 4} textAnchor="end" fontSize="10" fontFamily="IBM Plex Mono, monospace" fill="#3C557F">{pct}</text>
        </g>
      ))}

      {/* 60% pass threshold */}
      <line x1={padding.left} y1={thresholdY} x2={width - padding.right} y2={thresholdY} stroke="#D6273C" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />

      <polygon points={areaPoints} fill="#1D3A66" opacity="0.08" />
      <polyline points={linePoints} fill="none" stroke="#12233F" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {history.map((h, i) => (
        <circle
          key={i}
          cx={xFor(i)}
          cy={yFor(h.percentage)}
          r="4"
          fill={h.passed ? '#1E8E5A' : '#D6273C'}
          stroke="white"
          strokeWidth="1.5"
        />
      ))}
    </svg>
  );
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [oralStats, setOralStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [notices, setNotices] = useState([]);
  const [showNewNotice, setShowNewNotice] = useState(false);
  const [newNotice, setNewNotice] = useState({ title: '', body: '' });
  const { user, logout } = useContext(AuthContext);

  useEffect(() => {
    fetchStats();
    fetchNotices();
    fetchOralStats();
  }, []);

  const fetchOralStats = async () => {
    try {
      const response = await axios.get(`${API}/oral/stats`);
      setOralStats(response.data);
    } catch (error) {
      console.error('Error fetching oral stats:', error);
    }
  };

  const fetchNotices = async () => {
    try {
      const response = await axios.get(`${API}/notices`);
      setNotices(response.data);
    } catch (error) {
      console.error('Error fetching notices:', error);
    }
  };

  const createNotice = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/admin/notices`, newNotice);
      setNewNotice({ title: '', body: '' });
      setShowNewNotice(false);
      fetchNotices();
    } catch (error) {
      console.error('Error creating notice:', error);
    }
  };

  const deleteNotice = async (noticeId) => {
    try {
      await axios.delete(`${API}/admin/notices/${noticeId}`);
      fetchNotices();
    } catch (error) {
      console.error('Error deleting notice:', error);
    }
  };

  const formatNoticeDate = (iso) => {
    return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  };

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
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-xl font-display text-navy-900">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="bg-navy-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <img
                src="/logo-autoscuola.png"
                alt="Autoscuola Desenzanese"
                className="h-10 object-contain bg-white rounded-md p-1"
              />
              <h1 className="font-display text-xl font-semibold text-white">
                Esame Provinciale Brescia
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-navy-100 text-sm hidden sm:inline">
                Benvenuto, {user?.username} {user?.is_admin && '👑'}
              </span>
              <button
                onClick={() => setShowChangePassword(true)}
                className="bg-navy-700 text-white px-4 py-2 rounded-lg hover:bg-navy-600 transition-colors text-sm"
              >
                Cambia Password
              </button>
              <button
                onClick={logout}
                className="bg-brick-500 text-white px-4 py-2 rounded-lg hover:bg-brick-600 transition-colors text-sm"
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
        {/* Notices */}
        {(notices.length > 0 || user?.is_admin) && (
          <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-display text-xl font-semibold text-navy-900">📢 Notizie</h2>
              {user?.is_admin && (
                <button
                  onClick={() => setShowNewNotice(!showNewNotice)}
                  className="text-navy-600 hover:text-navy-900 text-sm font-medium"
                >
                  {showNewNotice ? 'Annulla' : '+ Nuova notizia'}
                </button>
              )}
            </div>

            {showNewNotice && (
              <form onSubmit={createNotice} className="mb-4 space-y-2 bg-paper p-4 rounded-lg">
                <input
                  type="text"
                  placeholder="Titolo"
                  value={newNotice.title}
                  onChange={(e) => setNewNotice({ ...newNotice, title: e.target.value })}
                  required
                  className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600"
                />
                <textarea
                  placeholder="Testo della notizia"
                  value={newNotice.body}
                  onChange={(e) => setNewNotice({ ...newNotice, body: e.target.value })}
                  required
                  rows={3}
                  className="w-full border border-navy-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-navy-600"
                />
                <button type="submit" className="bg-navy-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-navy-700 transition-colors">
                  Pubblica
                </button>
              </form>
            )}

            {notices.length === 0 ? (
              <p className="text-navy-400 text-sm">Nessuna notizia al momento.</p>
            ) : (
              <div className="space-y-3">
                {notices.map((n) => (
                  <div key={n.id} className="p-3 bg-paper rounded-lg border border-navy-50">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          {n.source === 'auto-bando' && <span className="text-xs">🏛️</span>}
                          <h4 className="font-medium text-navy-900 text-sm">{n.title}</h4>
                        </div>
                        <p className="text-navy-600 text-sm mt-1">{n.body}</p>
                        {n.url && (
                          <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-navy-600 hover:text-navy-900 text-xs font-medium underline mt-1 inline-block">
                            Vedi sul sito della Provincia →
                          </a>
                        )}
                        <p className="text-navy-400 text-xs mt-1 font-mono">{formatNoticeDate(n.created_at)}</p>
                      </div>
                      {user?.is_admin && (
                        <button
                          onClick={() => deleteNotice(n.id)}
                          className="text-brick-500 hover:text-brick-600 text-xs flex-shrink-0"
                        >
                          Elimina
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Admin Panel Access */}
        {user?.is_admin && (
          <div className="bg-navy-700 text-white p-6 rounded-xl mb-8">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="font-display text-xl font-semibold mb-1">👑 Pannello Amministratore</h2>
                <p className="text-navy-100 text-sm">Carica e gestisci le domande dell'esame</p>
              </div>
              <button
                onClick={() => {
                  window.location.hash = '#admin';
                  window.location.reload();
                }}
                className="bg-white text-navy-900 px-6 py-3 rounded-lg font-medium hover:bg-navy-50 transition-colors"
              >
                Gestisci Domande 🔧
              </button>
            </div>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-md border border-navy-200">
            <h3 className="text-sm font-medium text-navy-400 mb-1 uppercase tracking-wide">Tentativi Totali</h3>
            <p className="font-mono text-3xl font-semibold text-navy-900">{stats?.total_attempts || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md border border-navy-200">
            <h3 className="text-sm font-medium text-navy-400 mb-1 uppercase tracking-wide">Esami Superati</h3>
            <p className="font-mono text-3xl font-semibold text-leaf-500">{stats?.passed_attempts || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-md border border-navy-200 flex flex-col items-center justify-center">
            <h3 className="text-sm font-medium text-navy-400 mb-1 uppercase tracking-wide self-start">Tasso di Successo</h3>
            <SuccessGauge percentage={stats?.total_attempts > 0 ? Math.round((stats.passed_attempts / stats.total_attempts) * 100) : 0} />
          </div>
        </div>

        {/* Oral Stats Summary */}
        {oralStats && (oralStats.simulations_total > 0 || oralStats.by_category.urbana.sessions > 0 || oralStats.by_category.provincia.sessions > 0 || oralStats.by_category.normativa.sessions > 0) && (
          <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-8">
            <h2 className="font-display text-xl font-semibold text-navy-900 mb-4">🗺️ Prova Orale — Andamento</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-paper rounded-lg p-4">
                <p className="text-xs text-navy-400 uppercase tracking-wide mb-1">Cartografia Urbana</p>
                <p className="font-mono text-2xl font-semibold text-navy-900">{oralStats.by_category.urbana.avg_score}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-4">
                <p className="text-xs text-navy-400 uppercase tracking-wide mb-1">Cartografia Provincia</p>
                <p className="font-mono text-2xl font-semibold text-navy-900">{oralStats.by_category.provincia.avg_score}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-4">
                <p className="text-xs text-navy-400 uppercase tracking-wide mb-1">Normativa</p>
                <p className="font-mono text-2xl font-semibold text-navy-900">{oralStats.by_category.normativa.avg_score}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-4">
                <p className="text-xs text-navy-400 uppercase tracking-wide mb-1">Simulazioni Superate</p>
                <p className="font-mono text-2xl font-semibold text-navy-900">{oralStats.simulations_passed}/{oralStats.simulations_total}</p>
              </div>
            </div>
          </div>
        )}

        {/* Subject Stats */}
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-8">
          <h2 className="font-display text-xl font-semibold text-navy-900 mb-4">Statistiche per Argomento</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Object.entries(stats?.by_subject || {}).map(([subject, data]) => (
              <div key={subject} className="p-4 bg-paper rounded-lg border border-navy-50">
                <h3 className="font-medium text-navy-900 text-sm mb-2">{subject}</h3>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-navy-400">
                    <span>Tentativi:</span>
                    <span className="font-mono font-medium text-navy-900">{data.attempts}</span>
                  </div>
                  <div className="flex justify-between text-sm text-navy-400">
                    <span>Precisione:</span>
                    <span className="font-mono font-medium text-navy-900">{Math.round(data.accuracy)}%</span>
                  </div>
                  <div className="flex justify-between text-sm text-navy-400">
                    <span>Miglior Score:</span>
                    <span className="font-mono font-medium text-navy-900">{Math.round(data.best_score)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Progress Over Time */}
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-8">
          <h2 className="font-display text-xl font-semibold text-navy-900 mb-4">Andamento nel Tempo</h2>
          <ProgressChart history={stats?.history} />
        </div>

        {/* Quiz Modes */}
        <h2 className="font-display text-xl font-semibold text-navy-900 mb-4">📝 Prova Quiz</h2>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
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
          <QuizModeCard
            title="Ripassa Errori"
            description="Solo le domande che hai sbagliato finora"
            icon="🔁"
            type="review_errors"
            mistakesCount={stats?.mistakes_count || 0}
          />
        </div>

        {/* Oral Exam Entry */}
        <h2 className="font-display text-xl font-semibold text-navy-900 mb-4">🗺️ Prova Orale</h2>
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="font-medium text-navy-900 mb-1">Cartografia e Normativa</h3>
              <p className="text-navy-400 text-sm">Percorsi in città, percorsi in provincia, normativa orale, e simulazione completa a punteggio</p>
            </div>
            <button
              onClick={() => { window.location.hash = '#orale'; window.location.reload(); }}
              className="bg-navy-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-navy-700 transition-colors whitespace-nowrap"
            >
              Inizia →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Quiz Mode Card Component
const QuizModeCard = ({ title, description, icon, type, mistakesCount }) => {
  const [showSubjects, setShowSubjects] = useState(false);
  const [showLanguages, setShowLanguages] = useState(false);

  const subjects = [
    "Geografia regionale",
    "Normativa statale e regionale",
    "Normativa comunale TAXI e NCC",
    "Lingua Straniera - Inglese",
    "Lingua Straniera - Francese",
    "Lingua Straniera - Spagnolo",
    "Lingua Straniera - Tedesco"
  ];

  const languages = ["Inglese", "Francese", "Spagnolo", "Tedesco"];

  const startQuiz = async (subject = null, language = null) => {
    try {
      const quizData = { quiz_type: type };
      if (subject) quizData.subject = subject;
      if (language) quizData.language = language;

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
    <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6">
      <div className="text-center mb-4">
        <div className="text-4xl mb-2">{icon}</div>
        <h3 className="font-display text-lg font-semibold text-navy-900 mb-1">{title}</h3>
        <p className="text-navy-400 text-sm">{description}</p>
      </div>

      {type === 'review_errors' ? (
        <>
          <button
            onClick={() => startQuiz()}
            disabled={!mistakesCount}
            className="w-full bg-navy-900 text-white py-3 px-4 rounded-lg hover:bg-navy-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {mistakesCount ? 'Inizia Ripasso' : 'Nessun errore da ripassare'}
          </button>
          {mistakesCount > 0 && (
            <p className="text-center text-sm text-navy-400 mt-2 font-mono">
              {mistakesCount} {mistakesCount === 1 ? 'domanda' : 'domande'} da ripassare
            </p>
          )}
        </>
      ) : type === 'final_simulation' ? (
        <>
          <button
            onClick={() => setShowLanguages(!showLanguages)}
            className="w-full bg-navy-900 text-white py-3 px-4 rounded-lg hover:bg-navy-700 transition-colors font-medium"
          >
            Inizia Simulazione
          </button>

          {showLanguages && (
            <div className="mt-4">
              <p className="text-sm text-navy-400 mb-2 text-center">Scegli la lingua straniera per l'esame:</p>
              <div className="space-y-2">
                {languages.map((language) => (
                  <button
                    key={language}
                    onClick={() => startQuiz(null, language)}
                    className="w-full text-left p-3 bg-paper hover:bg-navy-50 rounded-lg transition-colors text-sm text-navy-900"
                  >
                    {language}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <button
            onClick={() => setShowSubjects(!showSubjects)}
            className="w-full bg-navy-900 text-white py-3 px-4 rounded-lg hover:bg-navy-700 transition-colors font-medium"
          >
            Scegli Argomento
          </button>

          {showSubjects && (
            <div className="mt-4 space-y-2">
              {subjects.map((subject) => (
                <button
                  key={subject}
                  onClick={() => startQuiz(subject)}
                  className="w-full text-left p-3 bg-paper hover:bg-navy-50 rounded-lg transition-colors text-sm text-navy-900"
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
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    const storedQuiz = localStorage.getItem('currentQuiz');
    if (storedQuiz) {
      const quiz = JSON.parse(storedQuiz);
      setQuizData(quiz);

      // Restore in-progress answers across a page reload instead of
      // silently resetting everything to unanswered.
      const storedAnswers = localStorage.getItem(`quizAnswers_${quiz.quiz_id}`);
      if (storedAnswers) {
        const parsed = JSON.parse(storedAnswers);
        if (Array.isArray(parsed) && parsed.length === quiz.questions.length) {
          setAnswers(parsed);
        } else {
          setAnswers(new Array(quiz.questions.length).fill(-1));
        }
      } else {
        setAnswers(new Array(quiz.questions.length).fill(-1));
      }

      // Base the countdown on an absolute deadline (from the server) rather
      // than a fixed duration, so reloading the page doesn't hand back extra time.
      if (quiz.expires_at) {
        const secondsLeft = Math.max(0, Math.round((new Date(quiz.expires_at).getTime() - Date.now()) / 1000));
        setTimeLeft(secondsLeft);
      } else if (quiz.time_limit) {
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
    if (quizData) {
      localStorage.setItem(`quizAnswers_${quizData.quiz_id}`, JSON.stringify(newAnswers));
    }
  };

  const handleSubmit = async () => {
    if (submitting || submitted) return; // guards against double-click / double timeout-trigger
    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/quiz/${quizData.quiz_id}/submit`, {
        answers: answers
      });
      
      localStorage.removeItem(`quizAnswers_${quizData.quiz_id}`);
      setResults(response.data);
      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting quiz:', error);
      // A 409 means this attempt was already submitted (e.g. from another
      // tab, or a retried request) — treat it as done rather than stuck.
      if (error.response?.status === 409) {
        setSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const goToDashboard = () => {
    if (quizData) {
      localStorage.removeItem(`quizAnswers_${quizData.quiz_id}`);
    }
    localStorage.removeItem('currentQuiz');
    window.location.hash = '';
    window.location.reload();
  };

  if (!quizData) {
    return <div className="min-h-screen bg-paper flex items-center justify-center">
      <div className="text-xl font-display text-navy-900">Caricamento quiz...</div>
    </div>;
  }

  if (submitted && results) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center px-4 py-8">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-lg p-8">
          <div className="text-center mb-8">
            <div className={`text-6xl mb-4 ${results.passed ? 'text-leaf-500' : 'text-brick-500'}`}>
              {results.passed ? '✅' : '❌'}
            </div>
            <h2 className="font-display text-3xl font-semibold text-navy-900 mb-2">
              {results.passed ? 'Esame Superato!' : 'Esame Non Superato'}
            </h2>
            <p className="text-navy-400">
              Hai risposto correttamente a <span className="font-mono font-medium text-navy-900">{results.total_correct}</span> su <span className="font-mono font-medium text-navy-900">{results.total_questions}</span> domande
            </p>
            {results.expired && (
              <p className="text-brick-500 text-sm mt-2 font-medium">
                Il tempo a disposizione (30 minuti) è scaduto prima della consegna: l'esame è considerato non superato.
              </p>
            )}
          </div>

          <div className="space-y-4 mb-8">
            {Object.entries(results.score_by_subject).map(([subject, score]) => (
              <div key={subject} className="p-4 bg-paper rounded-lg border border-navy-50">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-navy-900">{subject}</span>
                  <span className="font-mono text-lg font-semibold text-navy-900">
                    {score.correct}/{score.total}
                  </span>
                </div>
                <div className="mt-2 bg-navy-50 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      score.correct >= 3 ? 'bg-leaf-500' : 'bg-brick-500'
                    }`}
                    style={{ width: `${(score.correct / score.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          {(quizData.quiz_type === 'by_subject' || quizData.quiz_type === 'final_simulation') && (
            <div className="mb-8">
              <h3 className="font-display text-xl font-semibold text-navy-900 mb-4">Correzione</h3>
              <div className="space-y-4">
                {quizData.questions.map((question, index) => {
                  const userAnswer = answers[index];
                  const correctAnswer = results.correct_answers[index];
                  const isCorrect = userAnswer === correctAnswer;

                  return (
                    <div key={question.id} className="p-4 bg-paper rounded-lg border border-navy-50">
                      <div className="flex items-start gap-2 mb-3">
                        <span className={`text-xl ${isCorrect ? 'text-leaf-500' : 'text-brick-500'}`}>
                          {isCorrect ? '✓' : '✗'}
                        </span>
                        <p className="font-medium text-navy-900">{question.question_text}</p>
                      </div>
                      <div className="space-y-2 ml-7">
                        {question.options.map((option, optIndex) => {
                          let style = 'text-navy-400';
                          if (optIndex === correctAnswer) {
                            style = 'text-leaf-600 font-medium';
                          } else if (optIndex === userAnswer && !isCorrect) {
                            style = 'text-brick-600 font-medium';
                          }
                          return (
                            <div key={optIndex} className={`text-sm ${style}`}>
                              {String.fromCharCode(65 + optIndex)}) {option}
                              {optIndex === correctAnswer && ' ✓ (risposta corretta)'}
                              {optIndex === userAnswer && !isCorrect && ' ✗ (la tua risposta)'}
                            </div>
                          );
                        })}
                        {userAnswer === -1 && (
                          <div className="text-sm text-navy-400 italic">Nessuna risposta data</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <button
            onClick={goToDashboard}
            className="w-full bg-navy-900 text-white py-3 px-4 rounded-lg hover:bg-navy-700 transition-colors font-medium"
          >
            Torna alla Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = quizData.questions[currentQuestionIndex];

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h1 className="font-display text-xl font-semibold text-navy-900">
              {quizData.quiz_type === 'final_simulation' ? 'Simulazione Finale' : 
               quizData.quiz_type === 'free' ? 'Prova Libera' :
               quizData.quiz_type === 'review_errors' ? 'Ripassa Errori' : 'Prova per Argomento'}
            </h1>
            {timeLeft && (
              <div className="font-mono text-xl font-semibold text-brick-500">
                ⏰ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
            )}
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-navy-400 text-sm">
              Domanda <span className="font-mono text-navy-900">{currentQuestionIndex + 1}</span> di <span className="font-mono text-navy-900">{quizData.questions.length}</span>
            </span>
            <span className="text-navy-400 text-sm">
              {currentQuestion.subject}
            </span>
          </div>
          
          {/* Segmented "road" progress indicator */}
          <div className="mt-4 flex gap-1">
            {quizData.questions.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  idx < currentQuestionIndex ? 'bg-navy-600' :
                  idx === currentQuestionIndex ? 'bg-brick-500' : 'bg-navy-50'
                }`}
              ></div>
            ))}
          </div>
        </div>

        {/* Question */}
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-8 mb-6">
          <h2 className="text-xl font-medium text-navy-900 mb-6">
            {currentQuestion.question_text}
          </h2>
          
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              const isFreeMode = quizData.quiz_type === 'free' || quizData.quiz_type === 'review_errors';
              const hasAnswered = isFreeMode && answers[currentQuestionIndex] !== -1;
              const isSelected = answers[currentQuestionIndex] === index;
              const isCorrectOption = index === currentQuestion.correct_answer;

              let optionStyle = 'bg-paper border-navy-50 hover:bg-navy-50';
              if (isFreeMode && hasAnswered) {
                if (isCorrectOption) {
                  optionStyle = 'bg-leaf-50 border-leaf-500 text-leaf-600';
                } else if (isSelected) {
                  optionStyle = 'bg-brick-50 border-brick-500 text-brick-600';
                } else {
                  optionStyle = 'bg-paper border-navy-50 opacity-60';
                }
              } else if (isSelected) {
                optionStyle = 'bg-navy-50 border-navy-600 text-navy-900';
              }

              return (
                <button
                  key={index}
                  onClick={() => !hasAnswered && handleAnswerSelect(index)}
                  disabled={hasAnswered}
                  className={`w-full p-4 text-left rounded-lg border transition-colors ${optionStyle} ${hasAnswered ? 'cursor-default' : ''}`}
                >
                  <span className="font-mono font-medium">{String.fromCharCode(65 + index)})</span> {option}
                  {isFreeMode && hasAnswered && isCorrectOption && ' ✓'}
                  {isFreeMode && hasAnswered && isSelected && !isCorrectOption && ' ✗'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center">
          <button
            onClick={() => setCurrentQuestionIndex(Math.max(0, currentQuestionIndex - 1))}
            disabled={currentQuestionIndex === 0}
            className="bg-navy-100 text-navy-900 px-6 py-3 rounded-lg hover:bg-navy-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            ← Precedente
          </button>

          <div className="flex gap-3">
            {(quizData.quiz_type === 'free' || quizData.quiz_type === 'review_errors') && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="bg-brick-500 text-white px-6 py-3 rounded-lg hover:bg-brick-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                {submitting ? 'Invio...' : 'Interrompi e Vedi Risultato'}
              </button>
            )}

            {currentQuestionIndex === quizData.questions.length - 1 ? (
              quizData.quiz_type !== 'free' && quizData.quiz_type !== 'review_errors' && (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="bg-leaf-500 text-white px-6 py-3 rounded-lg hover:bg-leaf-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  {submitting ? 'Invio...' : 'Termina Quiz'}
                </button>
              )
            ) : (
              <button
                onClick={() => setCurrentQuestionIndex(Math.min(quizData.questions.length - 1, currentQuestionIndex + 1))}
                className="bg-navy-900 text-white px-6 py-3 rounded-lg hover:bg-navy-700 transition-colors"
              >
                Successiva →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Main App Component
// The 31 fixed points used in the oral exam's route-description test,
// gathered from the paper map the exam committee uses. Kept static here
// since the list rarely changes; can move to backend/admin if it needs
// to be editable without a redeploy.
const POI_CATEGORY_COLORS = {
  monumento: '#12233F',
  sanita: '#D6273C',
  trasporti: '#1E8E5A',
  hotel: '#B8860B',
  ospedale: '#D6273C',
  casa_di_cura: '#E0577A',
  montagna: '#1E8E5A',
  sciistico: '#3C557F',
  lago: '#3C557F',
  balneare: '#2E9CCA',
  enogastronomia: '#B8860B',
  altro: '#12233F',
};

// Local-only microphone recording for self-review — nothing is uploaded or
// saved anywhere; the clip lives only in the browser tab and disappears
// when the component unmounts or a new recording starts.
const AudioRecorder = () => {
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const startRecording = async () => {
    setError('');
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setError('Il tuo browser non supporta la registrazione audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError('Impossibile accedere al microfono. Controlla i permessi del browser.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  return (
    <div className="bg-paper rounded-lg p-3">
      <p className="text-xs text-navy-400 mb-2">🎙️ Facoltativo: registra la tua risposta a voce e riascoltala prima di darti un voto</p>
      <div className="flex items-center gap-2 flex-wrap">
        {!recording ? (
          <button type="button" onClick={startRecording} className="bg-navy-900 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-navy-700 transition-colors">
            ● Registra
          </button>
        ) : (
          <button type="button" onClick={stopRecording} className="bg-brick-500 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-brick-600 transition-colors">
            ■ Stop
          </button>
        )}
        {audioUrl && <audio controls src={audioUrl} style={{ height: '32px', maxWidth: '220px' }} />}
      </div>
      {error && <p className="text-brick-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

// 0-10 self-score, matching the real commission's scale (5 questions x 10 = 50, pass at 30).
const ScoreSelector = ({ onSubmit, submitting }) => {
  const [score, setScore] = useState(null);
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-3">
        {[...Array(11)].map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setScore(i)}
            className={`w-8 h-8 rounded text-sm font-mono font-medium transition-colors ${score === i ? 'bg-navy-900 text-white' : 'bg-paper text-navy-900 hover:bg-navy-50'}`}
          >
            {i}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={score === null || submitting}
        onClick={() => onSubmit(score)}
        className="bg-leaf-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-leaf-600 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Salvataggio...' : 'Conferma punteggio'}
      </button>
    </div>
  );
};

const RUBRIC_TEXT = {
  urbana: '8-10: hai nominato tutte le vie principali nell\'ordine corretto · 5-7: 1-2 errori o ordine impreciso · 0-4: risposta incompleta o molto sbagliata',
  provincia: '8-10: direzione corretta, comuni principali citati, conosci un\'alternativa · 5-7: direzione corretta ma comuni imprecisi o nessuna alternativa · 0-4: direzione sbagliata o risposta molto incompleta',
  normativa: '8-10: risposta completa e corretta · 5-7: risposta parziale o imprecisa · 0-4: risposta sbagliata o assente',
};

const OralExamPrep = () => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);

  const [poiCity, setPoiCity] = useState([]);
  const [poiProvince, setPoiProvince] = useState([]);
  const [poiLoading, setPoiLoading] = useState(true);
  const [oralStats, setOralStats] = useState(null);

  const [category, setCategory] = useState('urbana'); // urbana | provincia | normativa | simulazione
  const [subMode, setSubMode] = useState('guided'); // guided | quiz (only for urbana/provincia)

  const [fromPoi, setFromPoi] = useState('');
  const [toPoi, setToPoi] = useState('');
  const [provinceSearch, setProvinceSearch] = useState('');
  const [provinceSearchResults, setProvinceSearchResults] = useState([]);
  const [provinceCustomDest, setProvinceCustomDest] = useState(null);

  const [routeData, setRouteData] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [quizPair, setQuizPair] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [scoreSaving, setScoreSaving] = useState(false);
  const [lastScoreMsg, setLastScoreMsg] = useState('');

  const [normativaQuestion, setNormativaQuestion] = useState(null);
  const [normativaLoading, setNormativaLoading] = useState(false);
  const [normativaRevealed, setNormativaRevealed] = useState(false);

  // Simulation sequence state
  const [simSteps, setSimSteps] = useState(null); // array of {type, from, to, question}
  const [simIndex, setSimIndex] = useState(0);
  const [simScores, setSimScores] = useState([]);
  const [simTimeLeft, setSimTimeLeft] = useState(null);
  const [simRevealed, setSimRevealed] = useState(false);
  const [simRouteData, setSimRouteData] = useState(null);
  const [simDone, setSimDone] = useState(false);
  const [simResult, setSimResult] = useState(null);

  useEffect(() => {
    fetchPoi();
    fetchOralStats();
  }, []);

  const fetchPoi = async () => {
    setPoiLoading(true);
    try {
      const response = await axios.get(`${API}/poi`);
      setPoiCity(response.data.city || []);
      setPoiProvince(response.data.province || []);
    } catch (error) {
      console.error('Error fetching POI:', error);
    } finally {
      setPoiLoading(false);
    }
  };

  const fetchOralStats = async () => {
    try {
      const response = await axios.get(`${API}/oral/stats`);
      setOralStats(response.data);
    } catch (error) {
      console.error('Error fetching oral stats:', error);
    }
  };

  // Map init (once POIs are loaded)
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current || !window.L || poiLoading) return;
    const map = window.L.map(mapRef.current).setView([45.55, 10.3], 10);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    mapInstanceRef.current = map;
    markersLayerRef.current = window.L.layerGroup().addTo(map);
    routeLayerRef.current = window.L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 150);
    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [poiLoading]);

  // Redraw markers whenever the visible category (and therefore relevant POI set) changes
  useEffect(() => {
    if (!markersLayerRef.current || !mapInstanceRef.current) return;
    markersLayerRef.current.clearLayers();
    const visible = category === 'provincia' ? [...poiCity, ...poiProvince] : poiCity;
    visible.forEach((poi) => {
      window.L.circleMarker([poi.lat, poi.lng], {
        radius: 6,
        fillColor: POI_CATEGORY_COLORS[poi.category] || '#12233F',
        color: '#fff',
        weight: 2,
        fillOpacity: 0.9
      }).bindTooltip(poi.name, { direction: 'top' }).addTo(markersLayerRef.current);
    });
    if (category === 'urbana' && mapInstanceRef.current) {
      mapInstanceRef.current.setView([45.5398, 10.2199], 13);
    } else if (category === 'provincia' && mapInstanceRef.current) {
      mapInstanceRef.current.setView([45.55, 10.3], 10);
    }
  }, [category, poiCity, poiProvince]);

  const clearRoute = () => { if (routeLayerRef.current) routeLayerRef.current.clearLayers(); };

  const drawRoute = (geometry) => {
    clearRoute();
    if (!mapInstanceRef.current || !geometry || geometry.length === 0) return;
    const latlngs = geometry.map(([lng, lat]) => [lat, lng]);
    const line = window.L.polyline(latlngs, { color: '#D6273C', weight: 5, opacity: 0.9 });
    line.addTo(routeLayerRef.current);

    // Distinct start (green) and end (red) markers so the route is
    // unambiguous even at a glance, on top of the plain category markers.
    const start = latlngs[0];
    const end = latlngs[latlngs.length - 1];
    window.L.circleMarker(start, { radius: 9, fillColor: '#1E8E5A', color: '#fff', weight: 3, fillOpacity: 1 })
      .bindTooltip('Partenza', { permanent: false }).addTo(routeLayerRef.current);
    window.L.circleMarker(end, { radius: 9, fillColor: '#D6273C', color: '#fff', weight: 3, fillOpacity: 1 })
      .bindTooltip('Arrivo', { permanent: false }).addTo(routeLayerRef.current);

    routeLayerRef.current.bringToFront();
    mapInstanceRef.current.fitBounds(line.getBounds(), { padding: [40, 40] });
  };

  const calculateRoute = async (from, to, includeTowns) => {
    setRouteLoading(true);
    setRouteError('');
    try {
      const response = await axios.get(`${API}/route`, {
        params: { from_lat: from.lat, from_lng: from.lng, to_lat: to.lat, to_lng: to.lng, include_towns: !!includeTowns }
      });
      setRouteData(response.data);
      drawRoute(response.data.geometry);
      return response.data;
    } catch (error) {
      setRouteError('Impossibile calcolare il percorso. Riprova tra qualche secondo.');
      setRouteData(null);
      return null;
    } finally {
      setRouteLoading(false);
    }
  };

  const findPoi = (name) => poiCity.find(p => p.name === name) || poiProvince.find(p => p.name === name);

  const handleGuidedSubmit = (e) => {
    e.preventDefault();
    const from = findPoi(fromPoi);
    const to = category === 'provincia' && provinceCustomDest ? provinceCustomDest : findPoi(toPoi);
    if (!from || !to) return;
    setRevealed(false);
    setLastScoreMsg('');
    calculateRoute(from, to, category === 'provincia');
  };

  const drawRandomQuizPair = () => {
    if (category === 'urbana') {
      const shuffled = [...poiCity].sort(() => Math.random() - 0.5);
      setQuizPair({ from: shuffled[0], to: shuffled[1] });
    } else {
      const from = poiCity[Math.floor(Math.random() * poiCity.length)];
      const to = poiProvince[Math.floor(Math.random() * poiProvince.length)];
      setQuizPair({ from, to });
    }
    setRevealed(false);
    setRouteData(null);
    setLastScoreMsg('');
    clearRoute();
  };

  const revealQuizRoute = () => {
    if (!quizPair) return;
    setRevealed(true);
    calculateRoute(quizPair.from, quizPair.to, category === 'provincia');
  };

  const searchProvincePlace = async () => {
    if (provinceSearch.trim().length < 3) return;
    try {
      const response = await axios.get(`${API}/geocode-search`, { params: { q: provinceSearch } });
      setProvinceSearchResults(response.data.results || []);
    } catch (error) {
      console.error('Geocode search error:', error);
    }
  };

  const switchCategory = (cat) => {
    setCategory(cat);
    setSubMode('guided');
    setFromPoi(''); setToPoi(''); setProvinceCustomDest(null);
    setProvinceSearch(''); setProvinceSearchResults([]);
    setRouteData(null); setRouteError(''); setRevealed(false); setLastScoreMsg('');
    setQuizPair(null);
    clearRoute();
    if (cat === 'normativa') loadNormativaQuestion();
  };

  const loadNormativaQuestion = async () => {
    setNormativaLoading(true);
    setNormativaRevealed(false);
    setLastScoreMsg('');
    try {
      const response = await axios.get(`${API}/oral/normativa-questions`, { params: { count: 1 } });
      setNormativaQuestion(response.data[0]);
    } catch (error) {
      console.error('Error loading normativa question:', error);
    } finally {
      setNormativaLoading(false);
    }
  };

  const submitScore = async (sessionType, score) => {
    setScoreSaving(true);
    try {
      await axios.post(`${API}/oral/submit`, { session_type: sessionType, scores: [score] });
      setLastScoreMsg(`Punteggio ${score}/10 salvato.`);
      fetchOralStats();
    } catch (error) {
      console.error('Error submitting score:', error);
    } finally {
      setScoreSaving(false);
    }
  };

  const formatDuration = (seconds) => `circa ${Math.round(seconds / 60)} min`;
  const formatDistance = (meters) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;

  // --- Simulazione (timed 2+2+1 sequence with cumulative 0-10 scoring) ---
  const startSimulation = async () => {
    if (poiCity.length < 2 || poiProvince.length < 1) return;
    const shuffledCity = [...poiCity].sort(() => Math.random() - 0.5);
    const steps = [
      { type: 'urbana', from: shuffledCity[0], to: shuffledCity[1] },
      { type: 'urbana', from: shuffledCity[2] || shuffledCity[0], to: shuffledCity[3] || shuffledCity[1] },
      { type: 'provincia', from: poiCity[Math.floor(Math.random() * poiCity.length)], to: poiProvince[Math.floor(Math.random() * poiProvince.length)] },
      { type: 'provincia', from: poiCity[Math.floor(Math.random() * poiCity.length)], to: poiProvince[Math.floor(Math.random() * poiProvince.length)] },
      { type: 'normativa' },
    ];
    setSimSteps(steps);
    setSimIndex(0);
    setSimScores([]);
    setSimDone(false);
    setSimResult(null);
    setSimRevealed(false);
    setSimRouteData(null);
    setSimTimeLeft(90);

    if (steps[0].type !== 'normativa') {
      await calcSimRoute(steps[0]);
    } else {
      await loadSimNormativa();
    }
  };

  const calcSimRoute = async (step) => {
    setRouteLoading(true);
    try {
      const response = await axios.get(`${API}/route`, {
        params: { from_lat: step.from.lat, from_lng: step.from.lng, to_lat: step.to.lat, to_lng: step.to.lng, include_towns: step.type === 'provincia' }
      });
      setSimRouteData(response.data);
    } catch (error) {
      setSimRouteData(null);
    } finally {
      setRouteLoading(false);
    }
  };

  const loadSimNormativa = async () => {
    try {
      const response = await axios.get(`${API}/oral/normativa-questions`, { params: { count: 1 } });
      setSimRouteData({ question: response.data[0] });
    } catch (error) {
      setSimRouteData(null);
    }
  };

  useEffect(() => {
    if (simSteps && simTimeLeft !== null && simTimeLeft > 0 && !simRevealed) {
      const t = setTimeout(() => setSimTimeLeft(simTimeLeft - 1), 1000);
      return () => clearTimeout(t);
    } else if (simSteps && simTimeLeft === 0 && !simRevealed) {
      setSimRevealed(true);
    }
  }, [simTimeLeft, simSteps, simRevealed]);

  const simReveal = () => setSimRevealed(true);

  const simScoreAndNext = async (score) => {
    const newScores = [...simScores, score];
    setSimScores(newScores);

    if (simIndex + 1 >= simSteps.length) {
      const total = newScores.reduce((a, b) => a + b, 0);
      try {
        const response = await axios.post(`${API}/oral/submit`, { session_type: 'simulazione', scores: newScores });
        setSimResult(response.data);
      } catch (error) {
        setSimResult({ total_score: total, passed: total >= 30 });
      }
      setSimDone(true);
      fetchOralStats();
      return;
    }

    const nextIndex = simIndex + 1;
    setSimIndex(nextIndex);
    setSimRevealed(false);
    setSimRouteData(null);
    setSimTimeLeft(90);
    const nextStep = simSteps[nextIndex];
    if (nextStep.type !== 'normativa') {
      await calcSimRoute(nextStep);
    } else {
      await loadSimNormativa();
    }
  };

  const exitSimulation = () => {
    setSimSteps(null); setSimIndex(0); setSimScores([]); setSimDone(false); setSimResult(null);
  };

  const stepLabel = (type) => type === 'urbana' ? 'Cartografia Urbana' : type === 'provincia' ? 'Cartografia Provincia' : 'Normativa NCC';

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 mb-6">
          <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
            <div>
              <h1 className="font-display text-2xl font-semibold text-navy-900">🗺️ Prova Orale</h1>
              <p className="text-navy-400 text-sm mt-1">Cartografia e normativa, come nell'esame reale</p>
            </div>
            <button
              onClick={() => { window.location.hash = ''; window.location.reload(); }}
              className="bg-paper text-navy-900 px-4 py-2 rounded-lg hover:bg-navy-50 transition-colors text-sm font-medium whitespace-nowrap"
            >
              ← Torna alla Dashboard
            </button>
          </div>

          {oralStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-paper rounded-lg p-3">
                <p className="text-xs text-navy-400">Cartografia Urbana</p>
                <p className="font-mono text-lg font-semibold text-navy-900">{oralStats.by_category.urbana.avg_score || 0}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-3">
                <p className="text-xs text-navy-400">Cartografia Provincia</p>
                <p className="font-mono text-lg font-semibold text-navy-900">{oralStats.by_category.provincia.avg_score || 0}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-3">
                <p className="text-xs text-navy-400">Normativa</p>
                <p className="font-mono text-lg font-semibold text-navy-900">{oralStats.by_category.normativa.avg_score || 0}/10</p>
              </div>
              <div className="bg-paper rounded-lg p-3">
                <p className="text-xs text-navy-400">Simulazioni superate</p>
                <p className="font-mono text-lg font-semibold text-navy-900">{oralStats.simulations_passed}/{oralStats.simulations_total}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {[
              ['urbana', 'Cartografia Urbana'],
              ['provincia', 'Cartografia Provincia'],
              ['normativa', 'Normativa NCC'],
              ['simulazione', 'Simulazione Prova'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => key === 'simulazione' ? setCategory('simulazione') : switchCategory(key)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${category === key ? 'bg-navy-900 text-white' : 'bg-paper text-navy-900 hover:bg-navy-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {poiLoading ? (
          <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6 text-center text-navy-400">
            Caricamento punti...
          </div>
        ) : category === 'simulazione' ? (
          <div className="bg-white rounded-xl shadow-md border border-navy-200 p-6">
            {!simSteps ? (
              <div className="text-center py-8">
                <h3 className="font-display text-xl font-semibold text-navy-900 mb-2">Simulazione Prova Orale</h3>
                <p className="text-navy-400 text-sm mb-6 max-w-md mx-auto">
                  5 domande in sequenza (2 cartografia urbana, 2 cartografia provincia, 1 normativa), con un timer per ciascuna. Punteggio 0-10 a domanda, soglia di superamento 30/50 — come la commissione reale.
                </p>
                <button
                  onClick={startSimulation}
                  disabled={poiCity.length < 4 || poiProvince.length < 2}
                  className="bg-navy-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-navy-700 disabled:opacity-50 transition-colors"
                >
                  Inizia Simulazione
                </button>
                {(poiCity.length < 4 || poiProvince.length < 2) && (
                  <p className="text-brick-500 text-xs mt-3">Servono almeno 4 punti città e 2 punti provincia caricati per iniziare.</p>
                )}
              </div>
            ) : simDone ? (
              <div className="text-center py-8">
                <div className={`text-6xl mb-4 ${simResult?.passed ? 'text-leaf-500' : 'text-brick-500'}`}>
                  {simResult?.passed ? '✅' : '❌'}
                </div>
                <h3 className="font-display text-2xl font-semibold text-navy-900 mb-2">
                  {simResult?.passed ? 'Prova Superata' : 'Prova Non Superata'}
                </h3>
                <p className="font-mono text-3xl font-semibold text-navy-900 mb-1">{simResult?.total_score}/50</p>
                <p className="text-navy-400 text-sm mb-6">Soglia di superamento: 30/50</p>
                <button
                  onClick={exitSimulation}
                  className="bg-navy-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-navy-700 transition-colors"
                >
                  Nuova Simulazione
                </button>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <span className="text-sm text-navy-400">
                    Domanda <span className="font-mono text-navy-900">{simIndex + 1}</span> di <span className="font-mono text-navy-900">5</span> — {stepLabel(simSteps[simIndex].type)}
                  </span>
                  {simTimeLeft !== null && (
                    <span className="font-mono text-lg font-semibold text-brick-500">⏰ {Math.floor(simTimeLeft / 60)}:{(simTimeLeft % 60).toString().padStart(2, '0')}</span>
                  )}
                </div>

                {simSteps[simIndex].type !== 'normativa' ? (
                  <div className="bg-paper rounded-lg p-4 mb-4">
                    <p className="text-sm"><span className="text-navy-400">Partenza:</span> <span className="font-medium text-navy-900">{simSteps[simIndex].from.name}</span></p>
                    <p className="text-sm mt-1"><span className="text-navy-400">Arrivo:</span> <span className="font-medium text-navy-900">{simSteps[simIndex].to.name}</span></p>
                  </div>
                ) : (
                  <div className="bg-paper rounded-lg p-4 mb-4">
                    <p className="text-sm font-medium text-navy-900">{simRouteData?.question?.question_text || 'Caricamento domanda...'}</p>
                  </div>
                )}

                {!simRevealed ? (
                  <button
                    onClick={simReveal}
                    className="bg-brick-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brick-600 transition-colors"
                  >
                    Rivela Risposta
                  </button>
                ) : (
                  <div>
                    {simSteps[simIndex].type !== 'normativa' ? (
                      routeLoading ? <p className="text-navy-400 text-sm">Calcolo percorso...</p> : simRouteData && (
                        <div className="mb-4">
                          {simRouteData.compass_direction && (
                            <p className="text-sm mb-2"><span className="text-navy-400">Direzione:</span> <span className="font-medium text-navy-900">{simRouteData.compass_direction}</span></p>
                          )}
                          {simRouteData.towns && simRouteData.towns.length > 0 && (
                            <p className="text-sm mb-2"><span className="text-navy-400">Comuni attraversati:</span> <span className="font-medium text-navy-900">{simRouteData.towns.join(', ')}</span></p>
                          )}
                          <p className="text-xs text-navy-400 font-mono mb-2">{formatDistance(simRouteData.distance_m)} · {formatDuration(simRouteData.duration_s)}</p>
                          <ol className="space-y-1.5 text-sm text-navy-900 list-decimal list-inside">
                            {(simRouteData.instructions || simRouteData.streets.map(s => ({ text: `Prosegui su ${s}` }))).map((instr, i) => (
                              <li key={i}>{instr.text}{instr.distance_m ? ` (${formatDistance(instr.distance_m)})` : ''}</li>
                            ))}
                          </ol>
                        </div>
                      )
                    ) : (
                      simRouteData?.question && (
                        <div className="mb-4 space-y-1">
                          {simRouteData.question.options.map((opt, i) => (
                            <p key={i} className={`text-sm ${i === simRouteData.question.correct_answer ? 'text-leaf-600 font-medium' : 'text-navy-400'}`}>
                              {String.fromCharCode(65 + i)}) {opt} {i === simRouteData.question.correct_answer && '✓'}
                            </p>
                          ))}
                        </div>
                      )
                    )}

                    <AudioRecorder />

                    <div className="mt-4">
                      <p className="text-xs text-navy-400 mb-2">{RUBRIC_TEXT[simSteps[simIndex].type]}</p>
                      <ScoreSelector onSubmit={simScoreAndNext} submitting={false} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {category !== 'normativa' && (
              <div className="lg:col-span-2 bg-white rounded-xl shadow-md border border-navy-200 p-4">
                <div ref={mapRef} style={{ height: '480px', borderRadius: '0.5rem' }}></div>
              </div>
            )}

            <div className={category === 'normativa' ? 'lg:col-span-3 bg-white rounded-xl shadow-md border border-navy-200 p-6' : 'bg-white rounded-xl shadow-md border border-navy-200 p-6'}>
              {(category === 'urbana' || category === 'provincia') && (
                <>
                  <div className="flex gap-2 mb-4">
                    <button
                      onClick={() => { setSubMode('guided'); setRouteData(null); setRevealed(false); clearRoute(); }}
                      className={`px-3 py-1.5 rounded text-xs font-medium ${subMode === 'guided' ? 'bg-navy-900 text-white' : 'bg-paper text-navy-900'}`}
                    >
                      Percorso Guidato
                    </button>
                    <button
                      onClick={() => { setSubMode('quiz'); setQuizPair(null); setRouteData(null); setRevealed(false); clearRoute(); }}
                      className={`px-3 py-1.5 rounded text-xs font-medium ${subMode === 'quiz' ? 'bg-navy-900 text-white' : 'bg-paper text-navy-900'}`}
                    >
                      Autoverifica
                    </button>
                  </div>

                  {subMode === 'guided' && (
                    <form onSubmit={handleGuidedSubmit} className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-navy-400 mb-1">Partenza (città)</label>
                        <select value={fromPoi} onChange={(e) => setFromPoi(e.target.value)} className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600">
                          <option value="">Seleziona...</option>
                          {poiCity.map((poi) => <option key={poi.name} value={poi.name}>{poi.name}</option>)}
                        </select>
                      </div>

                      {category === 'urbana' ? (
                        <div>
                          <label className="block text-xs font-medium text-navy-400 mb-1">Arrivo (città)</label>
                          <select value={toPoi} onChange={(e) => setToPoi(e.target.value)} className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600">
                            <option value="">Seleziona...</option>
                            {poiCity.map((poi) => <option key={poi.name} value={poi.name}>{poi.name}</option>)}
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-medium text-navy-400 mb-1">Arrivo (provincia)</label>
                          <select value={toPoi} onChange={(e) => { setToPoi(e.target.value); setProvinceCustomDest(null); }} className="w-full bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-navy-600">
                            <option value="">Scegli dalla lista...</option>
                            {poiProvince.map((poi) => <option key={poi.name} value={poi.name}>{poi.name}</option>)}
                          </select>
                          <p className="text-xs text-navy-400 mb-1">— oppure cerca un indirizzo libero —</p>
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={provinceSearch}
                              onChange={(e) => setProvinceSearch(e.target.value)}
                              placeholder="es. Iseo, Chiari..."
                              className="flex-1 bg-paper border border-navy-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-600"
                            />
                            <button type="button" onClick={searchProvincePlace} className="bg-navy-100 text-navy-900 px-3 rounded-lg text-sm">🔍</button>
                          </div>
                          {provinceSearchResults.length > 0 && (
                            <div className="mt-1 border border-navy-100 rounded-lg overflow-hidden">
                              {provinceSearchResults.map((r, i) => (
                                <button
                                  type="button"
                                  key={i}
                                  onClick={() => { setProvinceCustomDest(r); setToPoi(''); setProvinceSearchResults([]); setProvinceSearch(r.name); }}
                                  className="block w-full text-left px-3 py-2 text-xs hover:bg-paper border-b border-navy-50 last:border-0"
                                >
                                  {r.full_name}
                                </button>
                              ))}
                            </div>
                          )}
                          {provinceCustomDest && <p className="text-xs text-leaf-600 mt-1">Selezionato: {provinceCustomDest.name}</p>}
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={!fromPoi || (!toPoi && !provinceCustomDest) || routeLoading}
                        className="w-full bg-navy-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-navy-700 disabled:opacity-50 transition-colors"
                      >
                        {routeLoading ? 'Calcolo...' : 'Mostra Percorso'}
                      </button>
                    </form>
                  )}

                  {subMode === 'quiz' && (
                    <div>
                      <button
                        onClick={drawRandomQuizPair}
                        className="w-full bg-navy-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-navy-700 transition-colors mb-3"
                      >
                        🎲 Estrai due punti
                      </button>
                      {quizPair && (
                        <div className="bg-paper rounded-lg p-3 mb-3">
                          <p className="text-sm"><span className="text-navy-400">Partenza:</span> <span className="font-medium text-navy-900">{quizPair.from.name}</span></p>
                          <p className="text-sm mt-1"><span className="text-navy-400">Arrivo:</span> <span className="font-medium text-navy-900">{quizPair.to.name}</span></p>
                        </div>
                      )}
                      {quizPair && !revealed && (
                        <button onClick={revealQuizRoute} disabled={routeLoading} className="w-full bg-brick-500 text-white py-2 rounded-lg text-sm font-medium hover:bg-brick-600 disabled:opacity-50 transition-colors">
                          {routeLoading ? 'Calcolo...' : 'Mostra il percorso'}
                        </button>
                      )}
                    </div>
                  )}

                  {routeError && <p className="text-brick-500 text-sm mt-3">{routeError}</p>}

                  {routeData && (subMode === 'guided' || revealed) && (
                    <div className="mt-4 pt-4 border-t border-navy-50">
                      {routeData.compass_direction && (
                        <p className="text-sm mb-2"><span className="text-navy-400">Direzione:</span> <span className="font-medium text-navy-900">{routeData.compass_direction}</span></p>
                      )}
                      {routeData.towns && routeData.towns.length > 0 && (
                        <p className="text-sm mb-2"><span className="text-navy-400">Comuni attraversati:</span> <span className="font-medium text-navy-900">{routeData.towns.join(', ')}</span></p>
                      )}
                      <p className="text-xs text-navy-400 font-mono mb-2">{formatDistance(routeData.distance_m)} · {formatDuration(routeData.duration_s)}</p>
                      <ol className="space-y-1.5 text-sm text-navy-900 list-decimal list-inside mb-4">
                        {(routeData.instructions || routeData.streets.map(s => ({ text: `Prosegui su ${s}` }))).map((instr, i) => (
                          <li key={i}>{instr.text}{instr.distance_m ? ` (${formatDistance(instr.distance_m)})` : ''}</li>
                        ))}
                      </ol>

                      <AudioRecorder />

                      <div className="mt-4">
                        <p className="text-xs text-navy-400 mb-2">{RUBRIC_TEXT[category]}</p>
                        <ScoreSelector onSubmit={(score) => submitScore(category, score)} submitting={scoreSaving} />
                        {lastScoreMsg && <p className="text-leaf-600 text-xs mt-2">{lastScoreMsg}</p>}
                      </div>
                    </div>
                  )}
                </>
              )}

              {category === 'normativa' && (
                <div>
                  <h3 className="font-display text-lg font-semibold text-navy-900 mb-3">Normativa NCC — Domanda Orale</h3>
                  {normativaLoading || !normativaQuestion ? (
                    <p className="text-navy-400 text-sm">Caricamento...</p>
                  ) : (
                    <>
                      <div className="bg-paper rounded-lg p-4 mb-4">
                        <p className="font-medium text-navy-900">{normativaQuestion.question_text}</p>
                      </div>

                      {!normativaRevealed ? (
                        <button onClick={() => setNormativaRevealed(true)} className="bg-brick-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brick-600 transition-colors">
                          Rivela Risposta
                        </button>
                      ) : (
                        <div>
                          <div className="space-y-1 mb-4">
                            {normativaQuestion.options.map((opt, i) => (
                              <p key={i} className={`text-sm ${i === normativaQuestion.correct_answer ? 'text-leaf-600 font-medium' : 'text-navy-400'}`}>
                                {String.fromCharCode(65 + i)}) {opt} {i === normativaQuestion.correct_answer && '✓'}
                              </p>
                            ))}
                          </div>

                          <AudioRecorder />

                          <div className="mt-4">
                            <p className="text-xs text-navy-400 mb-2">{RUBRIC_TEXT.normativa}</p>
                            <ScoreSelector onSubmit={(score) => submitScore('normativa', score)} submitting={scoreSaving} />
                            {lastScoreMsg && <p className="text-leaf-600 text-xs mt-2">{lastScoreMsg}</p>}
                          </div>

                          <button onClick={loadNormativaQuestion} className="mt-4 text-navy-600 hover:text-navy-900 text-sm font-medium">
                            Prossima domanda →
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function App() {
  const [currentView, setCurrentView] = useState('dashboard');

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#quiz') {
      setCurrentView('quiz');
    } else if (hash === '#admin') {
      setCurrentView('admin');
    } else if (hash === '#orale') {
      setCurrentView('orale');
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

          if (currentView === 'orale') {
            return <OralExamPrep />;
          }

          return <Dashboard />;
        }}
      </AuthContext.Consumer>
    </AuthProvider>
  );
}

export default App;
