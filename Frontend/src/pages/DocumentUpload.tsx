import { useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { Upload } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

// --- UNIVERSAL AUTH FETCH (fixes 401 for Google + email login) ---
async function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem("token");

  const headers: any = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(url, {
    ...options,
    headers,
    credentials: "include",
  });
}

export default function DocumentUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file || !title) {
      alert("Please select a file and enter a title.");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("summary", summary);

    try {
      const res = await authFetch(`${API_URL}/documents`, {
        method: "POST",
        body: formData, // IMPORTANT: do NOT add content-type manually
      });

      if (res.ok) {
        alert("Document uploaded successfully!");
        navigate("/dashboard");
      } else {
        const data = await res.json();
        alert(`Upload failed: ${data.message}`);
      }

    } catch (err) {
      console.error("Upload error:", err);
      alert("Error uploading document.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-8 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Upload Document</h1>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Summary</label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-2"
            rows={3}
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Select File</label>
          <input type="file" onChange={handleFileChange} />
        </div>

        <button
          onClick={handleUpload}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          disabled={loading}
        >
          <Upload className="w-4 h-4" />
          <span>{loading ? "Uploading..." : "Upload Document"}</span>
        </button>
      </div>
    </DashboardLayout>
  );
}
