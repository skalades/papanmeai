import { useState, useRef, useEffect, ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Camera, 
  ChevronRight, 
  User, 
  Phone, 
  Scissors, 
  CheckCircle2, 
  RefreshCcw, 
  ArrowLeft,
  Sparkles,
  Monitor,
  Upload,
  Image as ImageIcon,
  Ruler,
  Waves,
  Layers
} from "lucide-react";
import { analyzeFace, generateHairstyle, AnalysisResult } from "./lib/gemini";

type Step = "USER_INFO" | "HAIR_DETAILS" | "FACE_ANALYSIS" | "RECOMMENDATIONS" | "BARBER_VIEW";

interface UserData {
  name: string;
  phone: string;
  hairLength: string;
  hairType: string;
  hairThickness: string;
  capturedImage?: string;
  profilePicture?: string;
  generatedStyleImages: Record<string, string>; // Store multiple generated images
  analysis?: AnalysisResult;
  selectedStyle?: string;
}

const HAIR_LENGTHS = ["Pendek", "Sedang", "Panjang"];
const HAIR_TYPES = ["Lurus", "Bergelombang", "Ikal", "Kribo"];
const HAIR_THICKNESS = ["Tipis", "Sedang", "Tebal"];

const STEP_LABELS: Record<Step, string> = {
  USER_INFO: "INFORMASI PENGGUNA",
  HAIR_DETAILS: "DETAIL RAMBUT",
  FACE_ANALYSIS: "ANALISIS WAJAH",
  RECOMMENDATIONS: "REKOMENDASI",
  BARBER_VIEW: "TAMPILAN BARBER"
};

export default function App() {
  const [step, setStep] = useState<Step>("USER_INFO");
  const [userData, setUserData] = useState<UserData>({
    name: "",
    phone: "",
    hairLength: "Sedang",
    hairType: "Lurus",
    hairThickness: "Sedang",
    generatedStyleImages: {},
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [generatingStyles, setGeneratingStyles] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isStartingCamera = useRef(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUserData(prev => ({ ...prev, profilePicture: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async (deviceId?: string) => {
    if (isStartingCamera.current) return;
    setError(null);
    
    // Stop existing stream if we're switching cameras
    if (streamRef.current) {
      stopCamera();
    }

    isStartingCamera.current = true;
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Check if we should still be showing the camera
      if (step !== "FACE_ANALYSIS") {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Get list of cameras after permission is granted
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setCameras(videoDevices);
      
      // Set initial selected camera if not set
      if (!selectedCameraId && videoDevices.length > 0) {
        const currentTrack = stream.getVideoTracks()[0];
        const currentDeviceId = currentTrack.getSettings().deviceId;
        if (currentDeviceId) setSelectedCameraId(currentDeviceId);
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      if (err instanceof Error) {
        if (err.name === "NotReadableError" || err.name === "TrackStartError") {
          setError("Kamera sedang digunakan oleh aplikasi lain. Mohon tutup aplikasi kamera lain dan coba lagi.");
        } else if (err.name === "NotAllowedError") {
          setError("Izin kamera ditolak. Mohon izinkan akses kamera di pengaturan browser Anda.");
        } else {
          setError(`Gagal mengakses kamera: ${err.message}`);
        }
      } else {
        setError("Gagal mengakses kamera. Pastikan perangkat Anda memiliki kamera yang aktif.");
      }
    } finally {
      isStartingCamera.current = false;
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log("Camera track stopped:", track.label);
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const captureImage = async () => {
    setError(null);
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Ensure video is ready and has valid dimensions
      if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        console.error("Video dimensions are 0 or camera not ready.");
        setError("Kamera belum siap. Mohon tunggu sebentar agar sensor menyesuaikan, lalu coba lagi.");
        return;
      }

      const context = canvas.getContext("2d");
      if (context) {
        // Set canvas to a reasonable size for analysis to avoid huge payloads
        const maxWidth = 1024;
        const scale = Math.min(1, maxWidth / video.videoWidth);
        canvas.width = video.videoWidth * scale;
        canvas.height = video.videoHeight * scale;
        
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = canvas.toDataURL("image/jpeg", 0.8);
        setUserData(prev => ({ 
          ...prev, 
          capturedImage: imageData,
          generatedStyleImages: {},
          selectedStyle: undefined
        }));
        
        setIsAnalyzing(true);
        setError(null);
        try {
          const result = await analyzeFace(imageData, {
            length: userData.hairLength,
            type: userData.hairType,
            thickness: userData.hairThickness
          });
          setUserData(prev => ({ ...prev, analysis: result }));
          setStep("RECOMMENDATIONS");

          // Automatically trigger generation for all recommendations
          result.recommendations.forEach(rec => {
            generateIndividualStyle(imageData, rec.style);
          });
        } catch (error) {
          console.error("Analysis failed:", error);
          const errorMessage = error instanceof Error ? error.message : "Kesalahan tidak diketahui";
          setError(`Analisis Gagal: ${errorMessage}`);
        } finally {
          setIsAnalyzing(false);
          stopCamera();
        }
      }
    }
  };

  const generateIndividualStyle = async (image: string, style: string) => {
    setGeneratingStyles(prev => ({ ...prev, [style]: true }));
    try {
      const generatedImage = await generateHairstyle(image, style, {
        length: userData.hairLength,
        type: userData.hairType,
        thickness: userData.hairThickness
      });
      setUserData(prev => ({
        ...prev,
        generatedStyleImages: {
          ...prev.generatedStyleImages,
          [style]: generatedImage
        }
      }));
    } catch (error) {
      console.error(`Style generation failed for ${style}:`, error);
    } finally {
      setGeneratingStyles(prev => ({ ...prev, [style]: false }));
    }
  };

  const handleStyleSelection = (style: string) => {
    setUserData(prev => ({ ...prev, selectedStyle: style }));
  };

  useEffect(() => {
    if (step === "FACE_ANALYSIS") {
      startCamera(selectedCameraId);
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [step, selectedCameraId]);

  const renderStep = () => {
    switch (step) {
      case "USER_INFO":
        return (
          <motion.div 
            key="user-info"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-12 w-full max-w-md"
          >
            <div className="text-center space-y-4">
              <h2 className="text-5xl font-serif font-extralight tracking-tight text-gradient-gold">
                Selamat Datang
              </h2>
              <div className="flex items-center justify-center gap-4">
                <div className="h-px w-8 bg-gold-500/30" />
                <p className="text-zinc-400 text-[10px] tracking-[0.4em] uppercase font-light">Mulai Transformasi Anda</p>
                <div className="h-px w-8 bg-gold-500/30" />
              </div>
            </div>
            
            <div className="space-y-8">
              <div className="flex flex-col items-center gap-6">
                <div className="relative w-40 h-40 group">
                  <div className="absolute inset-0 border border-gold-500/20 rounded-full animate-[spin_20s_linear_infinite]" />
                  <div className="absolute inset-2 border border-gold-500/10 rounded-full animate-[spin_15s_linear_infinite_reverse]" />
                  <div className="absolute inset-4 overflow-hidden rounded-full glass-gold flex items-center justify-center group-hover:border-gold-500/40 transition-colors duration-500">
                    {userData.profilePicture ? (
                      <img src={userData.profilePicture} alt="Profil" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <User className="w-8 h-8 text-gold-500/30" />
                      </div>
                    )}
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-all duration-500 flex flex-col items-center justify-center gap-2 text-[9px] font-sans uppercase tracking-[0.2em] text-gold-200"
                    >
                      <Upload className="w-5 h-5 text-gold-500" /> 
                      <span>Unggah Foto</span>
                    </button>
                  </div>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept="image/*"
                  className="hidden"
                />
              </div>

              <div className="space-y-6">
                <div className="relative group">
                  <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-0 group-focus-within:h-8 bg-gold-500 transition-all duration-500" />
                  <input 
                    type="text" 
                    placeholder="NAMA LENGKAP"
                    value={userData.name}
                    onChange={e => setUserData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-transparent border-b border-white/10 p-4 text-white focus:border-gold-500 transition-all outline-none font-serif text-xl placeholder:text-zinc-700 placeholder:font-sans placeholder:text-xs placeholder:tracking-[0.3em]"
                  />
                </div>
                <div className="relative group">
                  <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-0 group-focus-within:h-8 bg-gold-500 transition-all duration-500" />
                  <input 
                    type="tel" 
                    placeholder="NOMOR TELEPON"
                    value={userData.phone}
                    onChange={e => setUserData(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-transparent border-b border-white/10 p-4 text-white focus:border-gold-500 transition-all outline-none font-serif text-xl placeholder:text-zinc-700 placeholder:font-sans placeholder:text-xs placeholder:tracking-[0.3em]"
                  />
                </div>
              </div>
            </div>

            <button 
              disabled={!userData.name || !userData.phone}
              onClick={() => setStep("HAIR_DETAILS")}
              className="w-full relative group overflow-hidden py-5 glass-gold hover:bg-gold-500/10 transition-all duration-500 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <div className="relative z-10 flex items-center justify-center gap-4 text-gold-200 font-serif text-lg tracking-widest uppercase italic">
                Langkah Berikutnya <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gold-500/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            </button>
          </motion.div>
        );

      case "HAIR_DETAILS":
        return (
          <motion.div 
            key="hair-details"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-12 w-full max-w-4xl"
          >
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-serif font-extralight tracking-tight text-gradient-gold uppercase">Profil Rambut</h2>
              <p className="text-zinc-500 text-[10px] tracking-[0.4em] uppercase font-light">Ceritakan tentang karakteristik rambut Anda</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-6">
                <label className="text-[10px] font-sans text-gold-500/50 uppercase tracking-[0.3em] flex items-center gap-3">
                  <Ruler className="w-3 h-3" /> Panjang
                </label>
                <div className="flex flex-col gap-3">
                  {HAIR_LENGTHS.map(l => (
                    <button 
                      key={l}
                      onClick={() => setUserData(prev => ({ ...prev, hairLength: l }))}
                      className={`group relative py-4 px-6 text-sm font-serif italic tracking-widest transition-all duration-500 border ${userData.hairLength === l ? 'bg-gold-500/10 border-gold-500 text-gold-200' : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'}`}
                    >
                      <span className="relative z-10">{l.toUpperCase()}</span>
                      {userData.hairLength === l && <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-500" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-6">
                <label className="text-[10px] font-sans text-gold-500/50 uppercase tracking-[0.3em] flex items-center gap-3">
                  <Waves className="w-3 h-3" /> Tipe
                </label>
                <div className="flex flex-col gap-3">
                  {HAIR_TYPES.map(t => (
                    <button 
                      key={t}
                      onClick={() => setUserData(prev => ({ ...prev, hairType: t }))}
                      className={`group relative py-4 px-6 text-sm font-serif italic tracking-widest transition-all duration-500 border ${userData.hairType === t ? 'bg-gold-500/10 border-gold-500 text-gold-200' : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'}`}
                    >
                      <span className="relative z-10">{t.toUpperCase()}</span>
                      {userData.hairType === t && <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-500" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-6">
                <label className="text-[10px] font-sans text-gold-500/50 uppercase tracking-[0.3em] flex items-center gap-3">
                  <Layers className="w-3 h-3" /> Ketebalan
                </label>
                <div className="flex flex-col gap-3">
                  {HAIR_THICKNESS.map(th => (
                    <button 
                      key={th}
                      onClick={() => setUserData(prev => ({ ...prev, hairThickness: th }))}
                      className={`group relative py-4 px-6 text-sm font-serif italic tracking-widest transition-all duration-500 border ${userData.hairThickness === th ? 'bg-gold-500/10 border-gold-500 text-gold-200' : 'bg-white/5 border-white/5 text-zinc-500 hover:border-white/20'}`}
                    >
                      <span className="relative z-10">{th.toUpperCase()}</span>
                      {userData.hairThickness === th && <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-500" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-6 pt-8">
              <button 
                onClick={() => setStep("USER_INFO")}
                className="flex-1 py-5 glass hover:bg-white/10 transition-all duration-500 text-zinc-400 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4"
              >
                <ArrowLeft className="w-5 h-5" /> Kembali
              </button>
              <button 
                onClick={() => setStep("FACE_ANALYSIS")}
                className="flex-[2] py-5 glass-gold hover:bg-gold-500/10 transition-all duration-500 text-gold-200 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4"
              >
                Analisis Wajah <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        );

      case "FACE_ANALYSIS":
        return (
          <motion.div 
            key="face-analysis"
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-12 w-full max-w-4xl flex flex-col items-center"
          >
            <div className="text-center space-y-4">
              <h2 className="text-4xl font-serif font-extralight tracking-tight text-gradient-gold uppercase">Pemindaian Wajah</h2>
              <p className="text-zinc-500 text-[10px] tracking-[0.4em] uppercase font-light">Posisikan wajah Anda dalam bingkai emas</p>
            </div>

            <div className="relative w-full aspect-video glass overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)]">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover brightness-110 contrast-110 grayscale-[0.2]"
              />
              
              {/* Camera Selection Overlay */}
              {cameras.length > 1 && !isAnalyzing && !error && (
                <div className="absolute top-6 right-6 z-20">
                  <select 
                    value={selectedCameraId}
                    onChange={(e) => setSelectedCameraId(e.target.value)}
                    className="bg-black/80 text-gold-500 text-[9px] font-sans uppercase tracking-[0.2em] p-3 border border-gold-500/20 outline-none hover:border-gold-500/50 transition-all cursor-pointer backdrop-blur-md"
                  >
                    {cameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId} className="bg-zinc-900">
                        {camera.label || `Kamera ${cameras.indexOf(camera) + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Luxury Frame Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute inset-[10%] border border-gold-500/20 rounded-[40px]" />
                <div className="absolute inset-[10.5%] border border-gold-500/10 rounded-[38px]" />
                
                {/* Corner Accents */}
                <div className="absolute top-[10%] left-[10%] w-12 h-12 border-t-2 border-l-2 border-gold-500" />
                <div className="absolute top-[10%] right-[10%] w-12 h-12 border-t-2 border-r-2 border-gold-500" />
                <div className="absolute bottom-[10%] left-[10%] w-12 h-12 border-b-2 border-l-2 border-gold-500" />
                <div className="absolute bottom-[10%] right-[10%] w-12 h-12 border-b-2 border-r-2 border-gold-500" />

                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-1 h-1 bg-gold-500 rounded-full animate-ping" />
                </div>
              </div>
              
              {isAnalyzing && (
                <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center gap-8">
                  <div className="relative w-24 h-24">
                    <RefreshCcw className="w-full h-full text-gold-500 animate-[spin_3s_linear_infinite]" />
                    <div className="absolute inset-0 border-4 border-gold-500/20 rounded-full" />
                  </div>
                  <div className="space-y-2 text-center">
                    <p className="text-gold-200 font-serif italic text-xl tracking-widest animate-pulse">Menganalisis Struktur Wajah</p>
                    <p className="text-gold-500/40 text-[9px] tracking-[0.5em] uppercase">AI Precision Engine Active</p>
                  </div>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center gap-6 p-12 text-center">
                  <div className="w-16 h-16 bg-red-500/10 flex items-center justify-center rounded-full border border-red-500/20">
                    <Scissors className="w-8 h-8 text-red-500" />
                  </div>
                  <div className="space-y-3">
                    <p className="text-red-400 font-serif text-2xl italic">Terjadi Kesalahan</p>
                    <p className="text-zinc-500 text-xs font-sans tracking-wide max-w-md mx-auto">{error}</p>
                  </div>
                  <button 
                    onClick={() => setError(null)}
                    className="mt-4 glass-gold px-10 py-3 text-gold-200 font-serif italic text-sm tracking-widest hover:bg-gold-500/10 transition-all"
                  >
                    Coba Lagi
                  </button>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />

            <div className="flex gap-6 w-full">
              <button 
                disabled={isAnalyzing}
                onClick={() => setStep("HAIR_DETAILS")}
                className="flex-1 py-5 glass hover:bg-white/10 transition-all duration-500 text-zinc-400 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4 disabled:opacity-30"
              >
                <ArrowLeft className="w-5 h-5" /> Kembali
              </button>
              <button 
                disabled={isAnalyzing}
                onClick={captureImage}
                className="flex-[2] py-5 glass-gold hover:bg-gold-500/10 transition-all duration-500 text-gold-200 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4 disabled:opacity-30"
              >
                <Camera className="w-5 h-5" /> Ambil & Analisis
              </button>
            </div>
          </motion.div>
        );

      case "RECOMMENDATIONS":
        return (
          <motion.div 
            key="recommendations"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-12 w-full max-w-6xl"
          >
            {/* Top Section: AI Justification */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
              <div className="lg:col-span-2">
                <div className="relative aspect-[4/5] glass overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.3)] group">
                  {userData.selectedStyle && generatingStyles[userData.selectedStyle] && (
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-10">
                      <RefreshCcw className="w-10 h-10 text-gold-500 animate-spin" />
                      <p className="text-gold-200 font-serif italic text-sm tracking-widest animate-pulse text-center px-8">Menghasilkan {userData.selectedStyle}...</p>
                    </div>
                  )}
                  <img 
                    src={(userData.selectedStyle ? userData.generatedStyleImages[userData.selectedStyle] : null) || userData.capturedImage} 
                    alt="Hasil Tangkapan" 
                    className={`w-full h-full object-cover transition-all duration-1000 ${(userData.selectedStyle && generatingStyles[userData.selectedStyle]) ? 'scale-110 blur-md' : 'scale-100'}`} 
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />
                  <div className="absolute bottom-6 left-6 right-6">
                    <p className="text-gold-500 text-[9px] tracking-[0.4em] uppercase font-light mb-1">Pratinjau Visual</p>
                    <p className="text-white font-serif italic text-lg">{userData.selectedStyle || "Pilih Gaya di Bawah"}</p>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-3 space-y-8">
                <div className="space-y-4">
                  <div className="flex items-center gap-4 text-gold-500/60 font-sans text-[10px] uppercase tracking-[0.4em]">
                    <Sparkles className="w-4 h-4 text-gold-500" /> Analisis Karakteristik
                  </div>
                  <h2 className="text-6xl font-serif font-extralight tracking-tight text-gradient-gold leading-tight">
                    Bentuk Wajah {userData.analysis?.faceShape}
                  </h2>
                </div>
                <div className="relative p-8 glass-gold border-l-0">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gold-500" />
                  <p className="text-gold-500/40 font-sans text-[9px] uppercase tracking-[0.3em] mb-4">Rekomendasi Stylist AI</p>
                  <p className="text-2xl text-zinc-200 leading-relaxed font-serif italic font-light">
                    "{userData.analysis?.justification}"
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Section: Recommendations */}
            <div className="space-y-8">
              <div className="flex items-center justify-between border-b border-white/5 pb-6">
                <h3 className="text-2xl font-serif font-light tracking-widest uppercase text-gold-200">Koleksi Gaya Terpilih</h3>
                <p className="text-zinc-500 text-[9px] tracking-[0.3em] uppercase">Kurasi Khusus Untuk Anda</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {userData.analysis?.recommendations.map((rec, idx) => (
                  <button 
                    key={idx}
                    onClick={() => handleStyleSelection(rec.style)}
                    className={`group relative text-left transition-all duration-700 overflow-hidden border ${userData.selectedStyle === rec.style ? 'bg-gold-500/10 border-gold-500 shadow-[0_0_30px_rgba(245,158,11,0.1)]' : 'bg-white/5 border-white/5 hover:border-white/20'}`}
                  >
                    <div className="aspect-[4/3] w-full bg-zinc-900 relative overflow-hidden">
                      {generatingStyles[rec.style] ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                          <RefreshCcw className="w-8 h-8 text-gold-500 animate-spin" />
                        </div>
                      ) : userData.generatedStyleImages[rec.style] ? (
                        <img 
                          src={userData.generatedStyleImages[rec.style]} 
                          alt={rec.style} 
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-zinc-800" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                      <div className={`absolute top-4 right-4 font-serif text-2xl font-light italic ${userData.selectedStyle === rec.style ? 'text-gold-500' : 'text-zinc-700'}`}>
                        {rec.score}%
                      </div>
                    </div>
                    <div className="p-6 space-y-3">
                      <h4 className="text-lg font-serif italic tracking-wider text-white">
                        {rec.style}
                      </h4>
                      <p className={`text-[11px] leading-relaxed line-clamp-2 font-light ${userData.selectedStyle === rec.style ? 'text-zinc-300' : 'text-zinc-500'}`}>
                        {rec.description}
                      </p>
                      {userData.selectedStyle === rec.style && (
                        <div className="flex items-center gap-2 text-gold-500 font-medium text-[10px] uppercase tracking-[0.2em] pt-2">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Konfirmasi Pilihan
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-6 pt-8">
              <button 
                onClick={() => setStep("FACE_ANALYSIS")}
                className="flex-1 py-5 glass hover:bg-white/10 transition-all duration-500 text-zinc-400 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4"
              >
                <RefreshCcw className="w-5 h-5" /> Pindai Ulang
              </button>
              <button 
                disabled={!userData.selectedStyle}
                onClick={() => setStep("BARBER_VIEW")}
                className="flex-[2] py-5 glass-gold hover:bg-gold-500/10 transition-all duration-500 text-gold-200 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4 disabled:opacity-30"
              >
                Konfirmasi Pilihan <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </motion.div>
        );

      case "BARBER_VIEW":
        return (
          <motion.div 
            key="barber-view"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-12 w-full max-w-7xl"
          >
            <div className="flex flex-col md:flex-row items-center justify-between border-b border-white/10 pb-10 gap-8">
              <div className="space-y-3 text-center md:text-left">
                <h2 className="text-5xl font-serif font-extralight tracking-tight text-gradient-gold uppercase">Tampilan Barber</h2>
                <p className="text-gold-500/40 font-sans text-[10px] uppercase tracking-[0.5em]">Technical Grooming Specification</p>
              </div>
              <div className="text-center md:text-right glass-gold px-8 py-4 border-l-0">
                <p className="text-white font-serif italic text-2xl tracking-wide">{userData.name}</p>
                <p className="text-gold-500/60 font-sans text-xs tracking-widest mt-1">{userData.phone}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
              {/* Technical Profile */}
              <div className="lg:col-span-4 space-y-8">
                <div className="glass p-8 space-y-8">
                  <h3 className="text-[10px] font-sans text-gold-500/50 uppercase tracking-[0.4em] flex items-center gap-4">
                    <User className="w-4 h-4" /> Profil Teknis Klien
                  </h3>
                  <div className="grid grid-cols-1 gap-8">
                    <div className="space-y-1">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Bentuk Wajah</p>
                      <p className="font-serif italic text-xl text-gold-200">{userData.analysis?.faceShape}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Gaya Terpilih</p>
                      <p className="font-serif italic text-xl text-gold-200">{userData.selectedStyle}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Tipe Rambut</p>
                        <p className="font-serif italic text-lg text-zinc-300">{userData.hairType}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[9px] text-zinc-600 uppercase tracking-widest">Ketebalan</p>
                        <p className="font-serif italic text-lg text-zinc-300">{userData.hairThickness}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="glass-gold p-8 border-l-0 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gold-500" />
                  <h3 className="text-[9px] font-sans text-gold-500/40 uppercase tracking-[0.3em] mb-4">Catatan AI</h3>
                  <p className="text-sm text-zinc-400 italic leading-relaxed font-serif">
                    {userData.analysis?.justification}
                  </p>
                </div>
              </div>

              {/* Multi-Angle View */}
              <div className="lg:col-span-8 space-y-6">
                <h3 className="text-[10px] font-sans text-gold-500/50 uppercase tracking-[0.4em] flex items-center gap-4">
                  <Monitor className="w-4 h-4" /> Studio Visualization (3-Angle)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-4">
                    <div className="aspect-[3/4] glass overflow-hidden relative group shadow-2xl">
                      <img src={(userData.selectedStyle ? userData.generatedStyleImages[userData.selectedStyle] : null) || userData.capturedImage} alt="Depan" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-1000" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-40" />
                      <div className="absolute bottom-4 left-4 glass px-3 py-1.5 text-[9px] font-sans text-gold-200 uppercase tracking-widest border-white/10">Depan (AI)</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="aspect-[3/4] glass overflow-hidden relative group opacity-40 grayscale">
                      <img src={userData.capturedImage} alt="Samping" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Camera className="w-10 h-10 text-gold-500/20" />
                      </div>
                      <div className="absolute bottom-4 left-4 glass px-3 py-1.5 text-[9px] font-sans text-zinc-500 uppercase tracking-widest border-white/10">Samping</div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="aspect-[3/4] glass overflow-hidden relative group opacity-20 grayscale">
                      <img src={userData.capturedImage} alt="Belakang" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <Camera className="w-10 h-10 text-gold-500/10" />
                      </div>
                      <div className="absolute bottom-4 left-4 glass px-3 py-1.5 text-[9px] font-sans text-zinc-700 uppercase tracking-widest border-white/10">Belakang</div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-4 pt-4">
                  <div className="h-px w-8 bg-white/5" />
                  <p className="text-[9px] text-zinc-700 font-sans text-center uppercase tracking-[0.4em]">
                    Multi-angle capture requires secondary sensor array
                  </p>
                  <div className="h-px w-8 bg-white/5" />
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 pt-12">
              <button 
                onClick={() => setStep("RECOMMENDATIONS")}
                className="flex-1 py-5 glass hover:bg-white/10 transition-all duration-500 text-zinc-400 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4"
              >
                <ArrowLeft className="w-5 h-5" /> Kembali ke Gaya
              </button>
              <button 
                onClick={() => window.location.reload()}
                className="flex-1 py-5 glass-gold hover:bg-gold-500/10 transition-all duration-500 text-gold-200 font-serif text-lg tracking-widest uppercase italic flex items-center justify-center gap-4"
              >
                <CheckCircle2 className="w-5 h-5" /> Selesaikan Sesi
              </button>
            </div>
          </motion.div>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-gold-500 selection:text-black overflow-x-hidden">
      {/* Atmospheric Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[60%] h-[60%] bg-gold-900/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[20%] -right-[10%] w-[50%] h-[50%] bg-gold-600/5 blur-[100px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] mix-blend-overlay" />
      </div>

      {/* Header Branding */}
      <header className="relative z-50 p-8 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-4 group cursor-pointer">
          <div className="relative w-12 h-12 flex items-center justify-center">
            <div className="absolute inset-0 border border-gold-500/30 rotate-45 group-hover:rotate-90 transition-transform duration-700" />
            <Scissors className="text-gold-500 w-6 h-6 relative z-10" />
          </div>
          <div>
            <h1 className="text-3xl font-serif font-light tracking-[0.2em] uppercase text-gradient-gold leading-none">
              PAPA N ME
            </h1>
            <p className="text-[9px] font-sans text-gold-500/50 uppercase tracking-[0.4em] mt-1">Precision Grooming Studio</p>
          </div>
        </div>
        
        <div className="flex items-center gap-8">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest">System Status</span>
            <span className="text-[10px] font-medium text-gold-400 flex items-center gap-2 uppercase tracking-tighter">
              <div className="w-1.5 h-1.5 bg-gold-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" /> 
              Operational
            </span>
          </div>
          <div className="w-px h-10 bg-white/10" />
          <div className="text-right">
            <p className="text-[9px] font-sans text-zinc-500 uppercase tracking-widest">Current Phase</p>
            <p className="text-xs font-serif italic text-gold-200 tracking-wider">
              {STEP_LABELS[step]}
            </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-200px)] p-6 max-w-7xl mx-auto w-full">
        <AnimatePresence mode="wait">
          {renderStep()}
        </AnimatePresence>
      </main>

      {/* Footer Decoration */}
      <footer className="relative z-10 p-10 flex flex-col md:flex-row justify-between items-center gap-6 border-t border-white/5 max-w-7xl mx-auto w-full">
        <div className="flex flex-col items-center md:items-start gap-2">
          <p className="text-[10px] font-sans text-zinc-500 uppercase tracking-[0.3em]">The Art of Modern Masculinity</p>
          <p className="text-[9px] font-sans text-zinc-700 tracking-widest uppercase">© 2026 PAPA N ME BARBERSHOP • EST. MMXXIV</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="h-px w-12 bg-gold-500/20" />
          <div className="flex gap-3">
            {[1, 2, 3].map(i => (
              <div key={i} className={`w-1 h-1 rounded-full transition-all duration-500 ${i === 1 ? 'bg-gold-500 shadow-[0_0_5px_rgba(245,158,11,0.8)]' : 'bg-zinc-800'}`} />
            ))}
          </div>
          <div className="h-px w-12 bg-gold-500/20" />
        </div>
      </footer>
    </div>
  );
}
