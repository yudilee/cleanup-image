"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import dynamic from "next/dynamic";
import { Upload, Eraser, Download, RefreshCw, Undo, RotateCcw, Paintbrush, SplitSquareHorizontal, X, Square, Lasso, Cpu, Zap, Wand2, Sparkles, ImageMinus, Expand, Layers, Share2, Clock, Undo2, Redo2, ChevronRight, ChevronLeft, Settings, MoreHorizontal, Hand, Trash2, ZoomIn, ZoomOut, Maximize, Link2, Copy, Check } from 'lucide-react';
import { InpaintingCanvasHandle, ToolType } from "../components/InpaintingCanvas";

// Dynamic imports for canvas components
const InpaintingCanvas = dynamic(() => import("../components/InpaintingCanvas"), {
  ssr: false,
});

const BeforeAfterSlider = dynamic(() => import("../components/BeforeAfterSlider"), {
  ssr: false,
});

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null); // Current file being edited
  const [imageSrc, setImageSrc] = useState<string | null>(null); // Visual source for canvas
  const [maskBlob, setMaskBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [tool, setTool] = useState<ToolType>('brush');

  // Comparison mode
  const [showComparison, setShowComparison] = useState(false);
  const [beforeImage, setBeforeImage] = useState<string | null>(null);

  // Export format
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg' | 'webp'>('jpeg');
  const [jpegQuality, setJpegQuality] = useState(80);

  // Quality preset
  const [qualityPreset, setQualityPreset] = useState<'fast' | 'balanced' | 'high'>('high');
  const [deviceInfo, setDeviceInfo] = useState<string>('Loading...');

  // History for undo
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [zoomLevel, setZoomLevel] = useState(1);
  const canvasRef = useRef<InpaintingCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drag & Drop state
  const [isDragging, setIsDragging] = useState(false);

  // AI Features state
  const [aiLoading, setAiLoading] = useState<string | null>(null); // Current AI operation
  const [autoMask, setAutoMask] = useState<string | null>(null); // Auto-detected mask URL
  const bgInputRef = useRef<HTMLInputElement>(null);

  // Outpainting state
  const [showOutpaint, setShowOutpaint] = useState(false);
  const [outpaintValues, setOutpaintValues] = useState({ left: 50, right: 50, top: 50, bottom: 50 });

  // Batch processing state
  const [showBatch, setShowBatch] = useState(false);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number, total: number } | null>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);

  // History gallery state
  const [showHistory, setShowHistory] = useState(false);
  // AI Tools visibility
  const [showAiTools, setShowAiTools] = useState(false);
  // Settings/More visibility
  const [showSettings, setShowSettings] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("/api");
  const [copiedLink, setCopiedLink] = useState(false);

  // Check if Web Share is available
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator;

  // Helper to load an image from a File
  const loadImageFromFile = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setImageFile(file);
    setImageSrc(url);
    setMaskBlob(null);
    setHistory([url]);
    setHistoryIndex(0);
  }, []);

  // Helper to compress image if too large (Vercel 4.5MB limit)
  const compressImage = async (file: File, maxSizeMB: number = 3.5): Promise<File> => {
    if (file.size <= maxSizeMB * 1024 * 1024) return file;

    console.log(`Compressing image ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)...`);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // If generic compression isn't enough, we might need to resize.
        // Start with full size, JPEG 0.9
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error("Canvas context failed"));
          return;
        }

        // Fill white background to handle transparency if converting to JPEG
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Try reducing quality first
        let quality = 0.9;
        const tryCompress = (q: number) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("Compression failed"));
              return;
            }
            if (blob.size <= maxSizeMB * 1024 * 1024 || q <= 0.5) {
              console.log(`Compressed to ${(blob.size / 1024 / 1024).toFixed(2)}MB (Quality: ${q})`);
              resolve(new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            } else {
              // Recursive retry with lower quality
              tryCompress(q - 0.1);
            }
          }, "image/jpeg", q);
        };

        tryCompress(quality);
      };
      img.onerror = (e) => reject(e);
    });
  };

  // Use relative path for API calls. 
  // This requests goes to Next.js App Router, which we have configured (via route.ts) 
  // to proxy to the backend. This avoids CORS, Mixed Content, and Public Domain port blocking.
  // Use relative path for API calls. 
  // This requests goes to Next.js App Router, which we have configured (via route.ts) 
  // to proxy to the backend. This avoids CORS, Mixed Content, and Public Domain port blocking.
  // const API_BASE = "/api"; (REPLACED BY STATE apiBaseUrl)

  // Fetch device info on mount and handle connection logic
  useEffect(() => {
    // Environment Variables
    const ENV_COLAB_URL = process.env.NEXT_PUBLIC_COLAB_URL;
    const ENV_DEFAULT_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

    // 1. Initialize from URL param or LocalStorage or Env
    const params = new URLSearchParams(window.location.search);
    const urlApi = params.get('api');

    // Priority: 
    // 1. URL Param (Share link)
    // 2. LocalStorage (User manual set)
    // 3. ENV Colab (Deployed Config)
    // 4. ENV Default (Stable Fallback)

    // Helper to sanitize URLs (remove trailing slash)
    const cleanUrl = (url: string | undefined) => {
      if (!url) return undefined;
      return url.endsWith('/') ? url.slice(0, -1) : url;
    };

    let initialUrl = cleanUrl(ENV_DEFAULT_URL) || "/api";
    let preferredUrl = cleanUrl(ENV_COLAB_URL);

    // Determine what to try first
    let targetUrl = preferredUrl || initialUrl; // Default to Colab if set, else Default

    if (urlApi) {
      targetUrl = urlApi;
    } else {
      const stored = localStorage.getItem('apiBaseUrl');
      if (stored) targetUrl = stored;
    }

    // Set initial state
    setApiBaseUrl(targetUrl);

    // 2. Health Check & Fallback Logic
    const checkConnection = async (url: string) => {
      setDeviceInfo('Connecting...');
      try {
        const res = await axios.get(`${url}/device`, {
          headers: { 'ngrok-skip-browser-warning': 'true' },
          timeout: 5000 // 5s timeout
        });
        setDeviceInfo(res.data.device_name);

        // If connection successful and it's not the fallack, save it?
        // If it came from Env Colab, we might not want to "save" it to localStorage permanently 
        // masking future env updates. But for consistency, let's leave localStorage logic for manual overrides.
        if (url !== ENV_DEFAULT_URL) {
          // Only save if it was a manual action or URL param? 
          // Actually existing logic saves it if it works. That's fine.
        }

      } catch (err) {
        console.warn(`Connection to ${url} failed`, err);

        // Auto-fallback logic
        // If we are NOT already on the default URL, try the default.
        if (url !== ENV_DEFAULT_URL) {
          console.log(`Falling back to default: ${ENV_DEFAULT_URL}`);
          setApiBaseUrl(ENV_DEFAULT_URL);

          // Clear the bad stored value if it exists
          localStorage.removeItem('apiBaseUrl');

          // Verify the fallback
          setDeviceInfo('Connecting (Fallback)...');
          try {
            const res = await axios.get(`${ENV_DEFAULT_URL}/device`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
            setDeviceInfo(res.data.device_name);
          } catch (fallbackErr) {
            setDeviceInfo('Offline');
          }
        } else {
          setDeviceInfo('Offline');
        }
      }
    };

    checkConnection(targetUrl);

  }, []); // Run once on mount

  // Watch for manual changes to apiBaseUrl to save them (handled in the modal, but good to have)
  // Actually, we should probably separate "Init" from "Manual Update".
  // Let's modify the Modal save button to do the saving, and this effect just handles init.

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      loadImageFromFile(e.target.files[0]);
    }
  };

  // ============ DRAG & DROP ============
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('image/')) {
        loadImageFromFile(file);
      }
    }
  }, [loadImageFromFile]);

  // ============ CLIPBOARD PASTE ============
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            loadImageFromFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [loadImageFromFile]);

  // ============ KEYBOARD SHORTCUTS ============
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '[':
          setBrushSize((prev) => Math.max(5, prev - 5));
          break;
        case ']':
          setBrushSize((prev) => Math.min(100, prev + 5));
          break;
        case 'Escape':
          if (canvasRef.current) {
            canvasRef.current.clearLines();
          }
          break;
        case 'Enter':
          if (maskBlob && !loading) {
            handleClean();
          }
          break;
        case 'z':
        case 'Z':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
          }
          break;
        case 'y':
        case 'Y':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleRedo();
          }
          break;
        case 'b':
        case 'B':
          setTool('brush');
          break;
        case 'e':
        case 'E':
          setTool('eraser');
          break;
        case 'h':
        case 'H':
          setTool('hand');
          break;
        case 'r':
        case 'R':
          setTool('rectangle');
          break;
        case 'l':
        case 'L':
          setTool('lasso');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maskBlob, loading, history]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDownload = async () => {
    if (!imageSrc) return;

    // If format is PNG, we can just download the blob directly if it's already PNG
    // But since backend always returns PNG, and we want to allow conversion:

    const img = new Image();
    img.src = imageSrc;
    await new Promise((resolve) => { img.onload = resolve; });

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill white background for JPEG (since transparency becomes black)
    if (exportFormat === 'jpeg') {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(img, 0, 0);

    const mimeType = `image/${exportFormat}`;
    const quality = (exportFormat === 'jpeg' || exportFormat === 'webp') ? jpegQuality / 100 : undefined;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat;
      link.download = `cleaned_image.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, mimeType, quality);
  };

  const handleClean = async () => {
    if (!imageFile || !maskBlob) return;
    setLoading(true);

    // Store the "before" image for comparison
    const beforeUrl = imageSrc;
    setBeforeImage(beforeUrl);

    // Compress if needed (Vercel limit workaround)
    let fileToSend = imageFile;
    try {
      fileToSend = await compressImage(imageFile);
    } catch (err) {
      console.warn("Compression failed, sending original:", err);
    }

    const formData = new FormData();
    formData.append("image", fileToSend);
    formData.append("mask", maskBlob, "mask.png");

    try {
      // 1. Submit Job
      const response = await axios.post(`${apiBaseUrl}/inpaint?quality=${qualityPreset}`, formData, {
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      const { job_id } = response.data;

      // 2. Poll Status
      let resultBlob: Blob | null = null;
      let failureCount = 0;

      while (true) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s

        try {
          const statusRes = await axios.get(`${apiBaseUrl}/jobs/${job_id}`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          const status = statusRes.data.status;
          failureCount = 0; // Reset failure count on success

          if (status === 'completed') {
            // 3. Get Result
            const resultRes = await axios.get(`${apiBaseUrl}/results/${job_id}`, {
              responseType: 'blob',
              headers: { 'ngrok-skip-browser-warning': 'true' }
            });
            resultBlob = resultRes.data;
            break;
          } else if (status === 'failed') {
            throw new Error(statusRes.data.error || "Job failed");
          }
        } catch (error) {
          console.warn("Poll failed, retrying...", error);
          failureCount++;
          // CPU processing might starve the server for minutes. 
          // We need to be very patient. 150 retries * 5s ~ 12 minutes of coverage.
          if (failureCount > 150) throw error;
          await new Promise(r => setTimeout(r, 5000)); // Wait 5s before retrying to relieve load
        }
      }

      if (!resultBlob) throw new Error("Failed to get result");

      const newImageBlob = resultBlob;
      const newUrl = URL.createObjectURL(newImageBlob);

      // Update state for continuous editing
      setImageSrc(newUrl);
      setImageFile(new File([newImageBlob], "cleaned.png", { type: "image/png" }));

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newUrl);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      // Clear lines on canvas
      if (canvasRef.current) {
        canvasRef.current.clearLines();
      }

      // Show comparison after successful clean
      setShowComparison(true);

    } catch (error: any) {
      console.error("Error processing image:", error);
      const msg = error.response?.data?.detail || error.message || "Unknown error";
      alert(`Error processing image: ${msg}\nStatus: ${error.response?.status}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const previousUrl = history[newIndex];

    setHistoryIndex(newIndex);
    setImageSrc(previousUrl);
    // We also need to update imageFile if we want next clean to work on previous image.
    // Fetch blob from URL to recreate File object
    fetch(previousUrl)
      .then(r => r.blob())
      .then(blob => {
        setImageFile(new File([blob], "restored.png", { type: "image/png" }));
      });

    if (canvasRef.current) {
      canvasRef.current.clearLines();
    }
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const nextUrl = history[newIndex];

    setHistoryIndex(newIndex);
    setImageSrc(nextUrl);

    fetch(nextUrl)
      .then(r => r.blob())
      .then(blob => {
        setImageFile(new File([blob], "restored.png", { type: "image/png" }));
      });

    if (canvasRef.current) {
      canvasRef.current.clearLines();
    }
  };

  const handleReset = () => {
    if (history.length > 0) {
      const first = history[0];
      setHistory([first]);
      setHistoryIndex(0);
      setImageSrc(first);
      fetch(first)
        .then(r => r.blob())
        .then(blob => {
          setImageFile(new File([blob], "original.png", { type: "image/png" }));
        });
      if (canvasRef.current) {
        canvasRef.current.clearLines();
      }
    }
  };

  // ============ AI FEATURE HANDLERS ============

  const handleAutoDetect = async () => {
    if (!imageFile) return;
    setAiLoading('detect');

    let fileToSend = imageFile;
    try { fileToSend = await compressImage(imageFile); } catch (e) { console.warn(e); }

    const formData = new FormData();
    formData.append("image", fileToSend);

    try {
      const response = await axios.post(`${apiBaseUrl}/auto-mask?invert=true`, formData, {
        responseType: "blob",
        timeout: 300000,
      });

      const maskUrl = URL.createObjectURL(response.data);
      setAutoMask(maskUrl);

      // Convert mask to a blob and set as maskBlob for cleaning
      setMaskBlob(response.data);

      alert("✨ Objects detected! The mask has been auto-generated. Click 'Clean' to remove detected areas.");
    } catch (error) {
      console.error("Error detecting objects:", error);
      alert("Error detecting objects. Ensure backend is running.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleRefineEdges = async () => {
    if (!imageFile || !maskBlob) {
      alert("Please draw a mask first, then refine edges.");
      return;
    }
    setAiLoading('refine');

    const formData = new FormData();
    formData.append("image", imageFile);
    formData.append("mask", maskBlob, "mask.png");

    try {
      const response = await axios.post(`${apiBaseUrl}/refine-edges`, formData, {
        responseType: "blob",
        timeout: 300000,
      });

      // Update mask with refined version
      setMaskBlob(response.data);
      alert("✨ Edges refined! Click 'Clean' to process.");
    } catch (error) {
      console.error("Error refining edges:", error);
      alert("Error refining edges.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleRemoveBackground = async () => {
    if (!imageFile) return;
    setAiLoading('remove-bg');

    let fileToSend = imageFile;
    try { fileToSend = await compressImage(imageFile); } catch (e) { console.warn(e); }

    const formData = new FormData();
    formData.append("image", fileToSend);

    try {
      const response = await axios.post(`${apiBaseUrl}/remove-background`, formData, {
        responseType: "blob",
        timeout: 300000,
      });

      const newUrl = URL.createObjectURL(response.data);
      setImageSrc(newUrl);
      setImageFile(new File([response.data], "no-bg.png", { type: "image/png" }));

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newUrl);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);

      if (canvasRef.current) {
        canvasRef.current.clearLines();
      }
    } catch (error) {
      console.error("Error removing background:", error);
      alert("Error removing background.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleReplaceBackground = async (bgFile: File) => {
    if (!imageFile) return;
    setAiLoading('replace-bg');

    let fileToSend = imageFile;
    let bgToSend = bgFile;
    try {
      // Vercel limit is 4.5MB Total. For 2 files, we limit each to ~2MB.
      fileToSend = await compressImage(imageFile, 2.0);
      bgToSend = await compressImage(bgFile, 2.0);
    } catch (e) { console.warn(e); }

    const formData = new FormData();
    formData.append("image", fileToSend);
    formData.append("background", bgToSend);

    try {
      const response = await axios.post(`${apiBaseUrl}/replace-background`, formData, {
        responseType: "blob",
        timeout: 300000,
      });

      const newUrl = URL.createObjectURL(response.data);
      setBeforeImage(imageSrc);
      setImageSrc(newUrl);
      setImageFile(new File([response.data], "new-bg.png", { type: "image/png" }));

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newUrl);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setShowComparison(true);

      if (canvasRef.current) {
        canvasRef.current.clearLines();
      }
    } catch (error) {
      console.error("Error replacing background:", error);
      alert("Error replacing background.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleOutpaint = async () => {
    if (!imageFile) return;
    setAiLoading('outpaint');

    let fileToSend = imageFile;
    try { fileToSend = await compressImage(imageFile); } catch (e) { console.warn(e); }

    const formData = new FormData();
    formData.append("image", fileToSend);

    const params = new URLSearchParams({
      extend_left: outpaintValues.left.toString(),
      extend_right: outpaintValues.right.toString(),
      extend_top: outpaintValues.top.toString(),
      extend_bottom: outpaintValues.bottom.toString(),
    });

    try {
      const response = await axios.post(`${apiBaseUrl}/outpaint?${params}`, formData, {
        responseType: "blob",
        timeout: 300000,
      });

      const newUrl = URL.createObjectURL(response.data);
      setBeforeImage(imageSrc);
      setImageSrc(newUrl);
      setImageFile(new File([response.data], "outpainted.png", { type: "image/png" }));

      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newUrl);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setShowOutpaint(false);
      setShowComparison(true);

      if (canvasRef.current) {
        canvasRef.current.clearLines();
      }
    } catch (error) {
      console.error("Error outpainting:", error);
      alert("Error extending canvas.");
    } finally {
      setAiLoading(null);
    }
  };

  const handleBatchProcess = async () => {
    if (batchFiles.length === 0) return;

    setAiLoading('batch');
    setBatchProgress({ current: 0, total: batchFiles.length });

    const formData = new FormData();
    batchFiles.forEach(file => {
      formData.append("images", file);
    });

    try {
      const response = await axios.post(
        `${apiBaseUrl}/batch-inpaint?quality=${qualityPreset}`,
        formData,
        {
          responseType: "blob",
          timeout: 600000, // 10 minutes for batch
        }
      );

      // Download the ZIP file
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cleaned_images.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setShowBatch(false);
      setBatchFiles([]);
      alert(`✅ Processed ${batchFiles.length} images! Check your downloads.`);
    } catch (error) {
      console.error("Error batch processing:", error);
      alert("Error processing batch. Try fewer images or lower quality.");
    } finally {
      setAiLoading(null);
      setBatchProgress(null);
    }
  };

  const handleShare = async () => {
    if (!imageSrc) return;

    try {
      // Convert URL to blob for sharing
      const response = await fetch(imageSrc);
      const blob = await response.blob();
      const file = new File([blob], 'cleaned_image.png', { type: 'image/png' });

      await navigator.share({
        title: 'Cleaned Image',
        text: 'Check out this image I cleaned with Cleanup Image!',
        files: [file],
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error("Error sharing:", error);
        // Fallback: copy image URL to clipboard
        try {
          await navigator.clipboard.writeText(imageSrc);
          alert('Link copied to clipboard!');
        } catch {
          alert('Sharing not supported on this device.');
        }
      }
    }
  };

  const handleLoadHistoryItem = (url: string, index: number) => {
    setImageSrc(url);
    fetch(url)
      .then(r => r.blob())
      .then(blob => {
        setImageFile(new File([blob], `history_${index}.png`, { type: "image/png" }));
      });
    if (canvasRef.current) {
      canvasRef.current.clearLines();
    }
    setMaskBlob(null);
  };

  return (
    <main
      className="min-h-screen bg-neutral-900 text-white p-8 flex flex-col items-center relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-purple-600/30 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-neutral-800 border-4 border-dashed border-purple-500 rounded-3xl p-12 text-center">
            <Upload size={64} className="mx-auto mb-4 text-purple-400" />
            <p className="text-2xl font-bold text-white">Drop your image here</p>
          </div>
        </div>
      )}

      <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Cleanup Image</h1>
      <p className="mb-2 text-neutral-400">Remove objects from your images with AI</p>
      <p className="mb-6 text-xs text-neutral-500">
        <span className="px-2 py-0.5 bg-neutral-800 rounded-full mr-2">1</span>Upload
        <span className="mx-2 text-neutral-600">→</span>
        <span className="px-2 py-0.5 bg-neutral-800 rounded-full mr-2">2</span>Draw mask
        <span className="mx-2 text-neutral-600">→</span>
        <span className="px-2 py-0.5 bg-neutral-800 rounded-full mr-2">3</span>Set quality
        <span className="mx-2 text-neutral-600">→</span>
        <span className="px-2 py-0.5 bg-purple-700 rounded-full mr-2">4</span>Clean
      </p>

      {/* Toolbar */}
      <div className="flex gap-2 mb-6 bg-neutral-800 p-3 rounded-xl shadow-lg border border-neutral-700 max-w-[95vw] overflow-x-auto pb-4 items-center">
        <label className="p-2 rounded-lg hover:bg-neutral-700 cursor-pointer text-blue-400 transition" title="Upload Image">
          <Upload size={20} />
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </label>

        <div className="w-px h-8 bg-neutral-600 mx-1"></div>

        <div className="flex items-center gap-2" title="Brush Size">
          <div className="w-1.5 h-1.5 rounded-full bg-white"></div>
          <input
            type="range"
            min="5"
            max="100"
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-20 accent-purple-500"
          />
          <div className="w-4 h-4 rounded-full bg-white"></div>
        </div>

        <div className="w-px h-8 bg-neutral-600 mx-1"></div>

        {/* Tool Toggle */}
        <div className="flex items-center gap-1 bg-neutral-700 rounded-lg p-1">
          <button
            onClick={() => setTool('hand')}
            className={`p-2 rounded-lg transition ${tool === 'hand' ? 'bg-yellow-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            title="Pan Tool (H)"
          >
            <Hand size={18} />
          </button>
          <div className="w-px h-6 bg-neutral-600 mx-1"></div>
          <button
            onClick={() => setTool('brush')}
            className={`p-2 rounded-lg transition ${tool === 'brush' ? 'bg-purple-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            title="Brush (B)"
          >
            <Paintbrush size={18} />
          </button>
          <button
            onClick={() => setTool('eraser')}
            className={`p-2 rounded-lg transition ${tool === 'eraser' ? 'bg-blue-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            title="Eraser (E)"
          >
            <Eraser size={18} />
          </button>
          <button
            onClick={() => setTool('rectangle')}
            className={`p-2 rounded-lg transition ${tool === 'rectangle' ? 'bg-green-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            title="Rectangle Selection (R)"
          >
            <Square size={18} />
          </button>
          <button
            onClick={() => setTool('lasso')}
            className={`p-2 rounded-lg transition ${tool === 'lasso' ? 'bg-orange-600 text-white' : 'text-neutral-400 hover:text-white'}`}
            title="Lasso Selection (L)"
          >
            <Lasso size={18} />
          </button>
        </div>

        {/* Mask Undo/Redo */}
        <div className="flex items-center gap-1 bg-neutral-700 rounded-lg p-1">
          <button
            onClick={() => canvasRef.current?.undo()}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-600 transition"
            title="Undo Mask Stroke (Ctrl+Z)"
          >
            <Undo2 size={18} />
          </button>
          <button
            onClick={() => canvasRef.current?.redo()}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-600 transition"
            title="Redo Mask Stroke (Ctrl+Y)"
          >
            <Redo2 size={18} />
          </button>
          <div className="w-px h-6 bg-neutral-600 mx-1"></div>
          <button
            onClick={() => canvasRef.current?.clearLines()}
            className="p-2 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-neutral-600 transition"
            title="Clear Mask"
          >
            <Trash2 size={18} />
          </button>
        </div>

        <button
          onClick={handleClean}
          disabled={!maskBlob || loading}
          className={`flex items-center gap-2 px-4 py-1 rounded-lg font-medium transition ${maskBlob && !loading ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'bg-neutral-700 text-neutral-500 cursor-not-allowed'}`}
        >
          {loading ? <RefreshCw className="animate-spin" size={20} /> : <Eraser size={20} />}
          <span>Clean</span>
        </button>

        <div className="w-px h-8 bg-neutral-600 mx-1"></div>

        {/* Settings Toggle */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg transition ${showSettings ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-white'}`}
          title="Toggle Settings & Advanced Tools"
        >
          <Settings size={20} />
        </button>

        {showSettings && (
          <div className="flex items-center gap-4 animate-in fade-in slide-in-from-left-2 duration-200">
            <div className="w-px h-8 bg-neutral-600 mx-1"></div>

            {/* Quality Preset */}
            <div className="flex items-center gap-2 group relative">
              <Zap size={16} className="text-yellow-400" />
              <select
                value={qualityPreset}
                onChange={(e) => setQualityPreset(e.target.value as 'fast' | 'balanced' | 'high')}
                className="bg-neutral-700 text-white rounded-lg px-2 py-1 text-sm cursor-pointer"
                title="Processing quality"
              >
                <option value="fast">Fast (512px)</option>
                <option value="balanced">Balanced (1024px)</option>
                <option value="high">Original</option>
              </select>
            </div>

            {/* Device Info */}
            <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition ${apiBaseUrl !== '/api' ? 'bg-green-900/40 text-green-400 border border-green-800' : 'bg-neutral-700/50 text-neutral-400'}`} title={apiBaseUrl !== '/api' ? `Connected to: ${apiBaseUrl}` : 'Local Backend'}>
              {apiBaseUrl !== '/api' ? <Link2 size={14} /> : <Cpu size={14} />}
              <span>{deviceInfo}</span>
            </div>

            {/* Connection Settings */}
            <button
              onClick={() => setShowConnection(true)}
              className={`p-1 rounded bg-neutral-700/50 hover:bg-neutral-600 transition ${apiBaseUrl !== '/api' ? 'text-green-400' : 'text-neutral-400'}`}
              title="Configure Backend Connection (Colab/Remote)"
            >
              <Link2 size={16} />
            </button>

            {imageSrc && (
              <>
                <div className="w-px h-8 bg-neutral-600 mx-1"></div>
                {/* Magic Tools */}
                <div className="flex items-center gap-1 bg-neutral-900/30 rounded-lg p-1">
                  <button
                    onClick={handleAutoDetect}
                    disabled={aiLoading !== null || loading}
                    className={`p-2 rounded-lg transition flex items-center gap-1 text-sm ${aiLoading === 'detect' ? 'bg-purple-600 text-white' : 'text-purple-300 hover:bg-purple-600/50 hover:text-white'}`}
                    title="Auto-detect"
                  >
                    <Wand2 size={16} />
                  </button>
                  <button
                    onClick={handleRefineEdges}
                    disabled={!maskBlob || aiLoading !== null || loading}
                    className={`p-2 rounded-lg transition flex items-center gap-1 text-sm ${aiLoading === 'refine' ? 'bg-blue-600 text-white' : maskBlob ? 'text-blue-300 hover:bg-blue-600/50 hover:text-white' : 'text-neutral-600 cursor-not-allowed'}`}
                    title="Refine edges"
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    onClick={handleRemoveBackground}
                    disabled={aiLoading !== null || loading}
                    className={`p-2 rounded-lg transition flex items-center gap-1 text-sm ${aiLoading === 'remove-bg' ? 'bg-green-600 text-white' : 'text-green-300 hover:bg-green-600/50 hover:text-white'}`}
                    title="Remove background"
                  >
                    <ImageMinus size={16} />
                  </button>
                  <label
                    className={`p-2 rounded-lg transition flex items-center gap-1 text-sm cursor-pointer ${aiLoading === 'replace-bg' ? 'bg-cyan-600 text-white' : 'text-cyan-300 hover:bg-cyan-600/50 hover:text-white'}`}
                    title="New BG"
                  >
                    <Upload size={16} />
                    <input
                      ref={bgInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleReplaceBackground(e.target.files[0]);
                        }
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setShowOutpaint(true)}
                    disabled={aiLoading !== null || loading}
                    className={`p-2 rounded-lg transition flex items-center gap-1 text-sm ${aiLoading === 'outpaint' ? 'bg-amber-600 text-white' : 'text-amber-300 hover:bg-amber-600/50 hover:text-white'}`}
                    title="Extend"
                  >
                    <Expand size={16} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={handleUndo}
          disabled={history.length <= 1 || loading}
          className={`p-2 rounded-lg transition ${history.length > 1 && !loading ? 'hover:bg-neutral-700 text-white' : 'text-neutral-600 cursor-not-allowed'}`}
          title="Undo last clean"
        >
          <Undo size={20} />
        </button>

        <button
          onClick={handleRedo}
          disabled={history.length === 0 || historyIndex >= history.length - 1 || loading}
          className={`p-2 rounded-lg transition ${historyIndex < history.length - 1 && !loading ? 'hover:bg-neutral-700 text-white' : 'text-neutral-600 cursor-not-allowed'}`}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={20} />
        </button>

        <div className="w-px h-8 bg-neutral-600 mx-1"></div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => canvasRef.current?.zoomOut()}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
            title="Zoom Out"
          >
            <ZoomOut size={20} />
          </button>

          <span className="text-xs text-neutral-400 w-10 text-center select-none font-mono">
            {Math.round(zoomLevel * 100)}%
          </span>

          <button
            onClick={() => canvasRef.current?.zoomIn()}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
            title="Zoom In"
          >
            <ZoomIn size={20} />
          </button>

          <button
            onClick={() => canvasRef.current?.resetZoom()}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition"
            title="Reset Zoom"
          >
            <Maximize size={20} />
          </button>
        </div>

        <button
          onClick={handleReset}
          disabled={history.length <= 1 || loading}
          className={`p-2 rounded-lg transition ${history.length > 1 && !loading ? 'hover:bg-neutral-700 text-white' : 'text-neutral-600 cursor-not-allowed'}`}
          title="Reset to original"
        >
          <RotateCcw size={20} />
        </button>

        {imageSrc && (
          <>
            {/* Comparison Toggle */}
            {history.length > 1 && (
              <button
                onClick={() => setShowComparison(!showComparison)}
                className={`p-2 rounded-lg transition ${showComparison ? 'bg-blue-600 text-white' : 'hover:bg-neutral-700 text-white'}`}
                title="Toggle Before/After comparison"
              >
                <SplitSquareHorizontal size={20} />
              </button>
            )}

            <div className="w-px bg-neutral-600 mx-2"></div>

            {/* Export Format Selector */}
            <select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as 'png' | 'jpeg' | 'webp')}
              className="bg-neutral-700 text-white rounded-lg px-2 py-1 text-sm"
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
              <option value="webp">WebP</option>
            </select>

            {(exportFormat === 'jpeg' || exportFormat === 'webp') && (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-neutral-400">Q:</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={jpegQuality}
                  onChange={(e) => setJpegQuality(Number(e.target.value))}
                  className="w-12 accent-purple-500"
                />
                <span className="text-neutral-400 w-6">{jpegQuality}</span>
              </div>
            )}

            <button
              onClick={handleDownload}
              className="p-2 rounded-lg hover:bg-neutral-700 text-white transition"
              title="Download current"
            >
              <Download size={20} />
            </button>

            {/* Batch Process Button */}
            <button
              onClick={() => setShowBatch(true)}
              className="p-2 rounded-lg hover:bg-neutral-700 text-yellow-400 transition"
              title="Batch process multiple images"
            >
              <Layers size={20} />
            </button>

            {/* History Gallery Button */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-lg transition ${showHistory ? 'bg-blue-600 text-white' : 'hover:bg-neutral-700 text-blue-400'}`}
              title="Toggle history gallery"
            >
              <Clock size={20} />
            </button>

            {/* Share Button */}
            {canShare && (
              <button
                onClick={handleShare}
                className="p-2 rounded-lg hover:bg-neutral-700 text-green-400 transition"
                title="Share image"
              >
                <Share2 size={20} />
              </button>
            )}
          </>
        )}

      </div>

      {/* History Gallery Panel */}
      {showHistory && history.length > 0 && (
        <div className="w-full max-w-4xl mb-4 bg-neutral-800/50 rounded-xl p-4 border border-neutral-700">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="text-blue-400" size={16} />
            <span className="text-sm font-medium">Edit History</span>
            <span className="text-xs text-neutral-500">({history.length} versions)</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {history.map((url, index) => (
              <button
                key={index}
                onClick={() => handleLoadHistoryItem(url, index)}
                className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition hover:border-blue-400 ${url === imageSrc ? 'border-blue-500 ring-2 ring-blue-500/50' : 'border-neutral-600'}`}
                title={index === 0 ? 'Original' : `Version ${index}`}
              >
                <img src={url} alt={`Version ${index}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          <div className="flex justify-between items-center mt-2 text-xs text-neutral-500">
            <span>← Original</span>
            <span>Current →</span>
          </div>
        </div>
      )}

      <div className="flex gap-8 flex-wrap justify-center items-start">
        {/* Loading indicator */}
        {loading && (
          <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center">
            <div className="bg-neutral-800 rounded-2xl p-8 text-center shadow-2xl">
              <RefreshCw className="animate-spin mx-auto mb-4 text-purple-500" size={48} />
              <p className="text-lg font-medium">Processing your image...</p>
              <p className="text-sm text-neutral-400 mt-2">This may take a moment on CPU</p>
            </div>
          </div>
        )}

        {/* Before/After Comparison */}
        {showComparison && beforeImage && imageSrc && history.length > 1 && (
          <div className="relative">
            <button
              onClick={() => setShowComparison(false)}
              className="absolute -top-2 -right-2 z-10 bg-neutral-700 hover:bg-neutral-600 rounded-full p-1"
            >
              <X size={16} />
            </button>
            <BeforeAfterSlider beforeSrc={beforeImage} afterSrc={imageSrc} />
          </div>
        )}

        {/* Editor */}
        {imageSrc && !showComparison && (
          <InpaintingCanvas
            ref={canvasRef}
            imageSrc={imageSrc}
            onMaskReady={setMaskBlob}
            brushSize={brushSize}
            tool={tool}
            onZoomChange={setZoomLevel}
          />
        )}

        {!imageSrc && (
          <div
            className="border-2 border-dashed border-neutral-700 rounded-3xl p-20 text-center text-neutral-500 cursor-pointer hover:border-purple-500 hover:text-purple-400 transition"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg">Drag & drop, paste, or click to upload</p>
            <p className="text-sm mt-2 opacity-75">Supports: JPG, PNG, WebP</p>
          </div>
        )}
      </div>

      {/* Batch Processing Modal */}
      {showBatch && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowBatch(false)}>
          <div
            className="bg-neutral-800 rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl border border-neutral-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Layers className="text-yellow-400" />
                Batch Process
              </h2>
              <button
                onClick={() => setShowBatch(false)}
                className="p-1 hover:bg-neutral-700 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-neutral-400 text-sm mb-4">
              Select multiple images to auto-cleanup. AI will detect and remove unwanted elements from all images.
            </p>

            <div
              className="border-2 border-dashed border-neutral-600 rounded-xl p-6 text-center cursor-pointer hover:border-yellow-500 transition mb-4"
              onClick={() => batchInputRef.current?.click()}
            >
              <input
                ref={batchInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    setBatchFiles(Array.from(e.target.files));
                  }
                }}
              />
              <Upload className="mx-auto mb-2 text-neutral-500" size={32} />
              <p className="text-neutral-300">Click to select images</p>
              <p className="text-neutral-500 text-xs mt-1">Select multiple files at once</p>
            </div>

            {batchFiles.length > 0 && (
              <div className="mb-4 max-h-32 overflow-y-auto">
                <p className="text-sm text-yellow-400 mb-2">{batchFiles.length} files selected:</p>
                <div className="space-y-1">
                  {batchFiles.slice(0, 5).map((f, i) => (
                    <div key={i} className="text-xs text-neutral-400 truncate">{f.name}</div>
                  ))}
                  {batchFiles.length > 5 && (
                    <div className="text-xs text-neutral-500">...and {batchFiles.length - 5} more</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowBatch(false); setBatchFiles([]); }}
                className="flex-1 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleBatchProcess}
                disabled={batchFiles.length === 0 || aiLoading === 'batch'}
                className={`flex-1 px-4 py-2 rounded-lg transition flex items-center justify-center gap-2 ${batchFiles.length > 0 && aiLoading !== 'batch' ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-neutral-600 cursor-not-allowed'}`}
              >
                {aiLoading === 'batch' ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Processing...
                  </>
                ) : (
                  <>
                    <Layers size={16} />
                    Process {batchFiles.length} Images
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outpainting Modal */}
      {showOutpaint && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowOutpaint(false)}>
          <div
            className="bg-neutral-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-neutral-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Expand className="text-amber-400" />
                Extend Canvas
              </h2>
              <button
                onClick={() => setShowOutpaint(false)}
                className="p-1 hover:bg-neutral-700 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-neutral-400 text-sm mb-6">
              Extend the image canvas in any direction. AI will fill the new areas intelligently.
            </p>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="w-16 text-sm text-neutral-300">Top:</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={outpaintValues.top}
                  onChange={(e) => setOutpaintValues(v => ({ ...v, top: Number(e.target.value) }))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-12 text-right text-sm text-amber-400">{outpaintValues.top}px</span>
              </div>
              <div className="flex items-center gap-4">
                <label className="w-16 text-sm text-neutral-300">Bottom:</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={outpaintValues.bottom}
                  onChange={(e) => setOutpaintValues(v => ({ ...v, bottom: Number(e.target.value) }))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-12 text-right text-sm text-amber-400">{outpaintValues.bottom}px</span>
              </div>
              <div className="flex items-center gap-4">
                <label className="w-16 text-sm text-neutral-300">Left:</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={outpaintValues.left}
                  onChange={(e) => setOutpaintValues(v => ({ ...v, left: Number(e.target.value) }))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-12 text-right text-sm text-amber-400">{outpaintValues.left}px</span>
              </div>
              <div className="flex items-center gap-4">
                <label className="w-16 text-sm text-neutral-300">Right:</label>
                <input
                  type="range"
                  min="0"
                  max="200"
                  value={outpaintValues.right}
                  onChange={(e) => setOutpaintValues(v => ({ ...v, right: Number(e.target.value) }))}
                  className="flex-1 accent-amber-500"
                />
                <span className="w-12 text-right text-sm text-amber-400">{outpaintValues.right}px</span>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowOutpaint(false)}
                className="flex-1 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleOutpaint}
                disabled={aiLoading === 'outpaint'}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg transition flex items-center justify-center gap-2"
              >
                {aiLoading === 'outpaint' ? (
                  <>
                    <RefreshCw className="animate-spin" size={16} />
                    Extending...
                  </>
                ) : (
                  <>
                    <Expand size={16} />
                    Extend Canvas
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Connection Modal */}
      {showConnection && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowConnection(false)}>
          <div
            className="bg-neutral-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-neutral-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Link2 className="text-green-400" />
                Backend Connection
              </h2>
              <button
                onClick={() => setShowConnection(false)}
                className="p-1 hover:bg-neutral-700 rounded"
              >
                <X size={20} />
              </button>
            </div>

            <p className="text-neutral-400 text-sm mb-4">
              Configure the API endpoint. Use this to connect to a remote backend (e.g., Google Colab via Ngrok).
            </p>

            <div className="mb-4">
              <label className="block text-sm text-neutral-300 mb-2">API Base URL</label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => {
                  let val = e.target.value;
                  // Remove trailing slash if present to avoid double slashes //api
                  if (val.length > 1 && val.endsWith('/')) {
                    val = val.slice(0, -1);
                  }
                  setApiBaseUrl(val);
                }}
                placeholder="https://xxxx.ngrok-free.app"
                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-4 py-2 text-white focus:border-green-500 focus:outline-none"
              />
              <p className="text-xs text-neutral-500 mt-2">
                Default: <code className="bg-neutral-900 px-1 rounded">/api</code> (Local Proxy)
              </p>
            </div>

            {/* Share Link Section */}
            {apiBaseUrl !== '/api' && (
              <div className="mb-6 p-3 bg-neutral-900 rounded-lg border border-neutral-700">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-neutral-400 font-medium">Share this connection</span>
                  {copiedLink && <span className="text-xs text-green-400 flex items-center gap-1"><Check size={10} /> Copied!</span>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 overflow-hidden">
                    <code className="text-xs text-neutral-500 whitespace-nowrap block truncate">
                      {typeof window !== 'undefined' ? `${window.location.origin}/?api=${apiBaseUrl}` : ''}
                    </code>
                  </div>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/?api=${apiBaseUrl}`;
                      navigator.clipboard.writeText(url);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    }}
                    className="p-1.5 bg-neutral-800 hover:bg-neutral-700 rounded text-neutral-300 transition"
                    title="Copy Shareable Link"
                  >
                    {copiedLink ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setApiBaseUrl("/api");
                  localStorage.removeItem('apiBaseUrl');
                }}
                className="px-4 py-2 text-sm text-neutral-400 hover:text-white transition"
              >
                Reset to Default
              </button>
              <button
                onClick={() => {
                  setShowConnection(false);

                  // Save to LocalStorage
                  if (apiBaseUrl !== '/api') {
                    localStorage.setItem('apiBaseUrl', apiBaseUrl);
                  } else {
                    localStorage.removeItem('apiBaseUrl');
                  }

                  // Test connection
                  setDeviceInfo('Testing...');
                  axios.get(`${apiBaseUrl}/device`, {
                    headers: { 'ngrok-skip-browser-warning': 'true' }
                  })
                    .then(res => setDeviceInfo(res.data.device_name))
                    .catch(() => setDeviceInfo('Connection Failed'));
                }}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-white font-medium transition"
              >
                Save & Test
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
