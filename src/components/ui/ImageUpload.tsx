import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, X, Image as ImageIcon, RefreshCw, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

const BUCKET = 'resource-images';

/** Resize an image file to fit within maxWidth × maxHeight, returns a Blob. */
async function resizeImage(
  file: File,
  maxWidth = 1200,
  maxHeight = 800,
  quality = 0.85,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Only downscale, never upscale
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create blob'));
        },
        file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        quality,
      );
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

interface ImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
  /** Max thumbnail width in px (default 1200) */
  maxWidth?: number;
  /** Max thumbnail height in px (default 800) */
  maxHeight?: number;
}

interface StorageImage {
  name: string;
  url: string;
  created_at: string;
}

export function ImageUpload({ value, onChange, label = 'Image', maxWidth = 1200, maxHeight = 800 }: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryImages, setGalleryImages] = useState<StorageImage[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getPublicUrl = (path: string) => {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  };

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Invalid file type', description: 'Please upload an image file (JPEG, PNG, WebP, GIF)', variant: 'destructive' });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Maximum file size is 10MB (will be resized)', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      // Resize image client-side before upload
      const resizedBlob = await resizeImage(file, maxWidth, maxHeight);
      const outExt = file.type === 'image/png' ? 'png' : 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${outExt}`;

      const { error } = await supabase.storage.from(BUCKET).upload(fileName, resizedBlob, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
      });

      if (error) {
        if (import.meta.env.DEV) console.error('Upload error:', error);
        toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      } else {
        const url = getPublicUrl(fileName);
        onChange(url);
        const savedKb = Math.round(resizedBlob.size / 1024);
        const origKb = Math.round(file.size / 1024);
        toast({ title: 'Image uploaded', description: origKb > savedKb ? `Resized: ${origKb}KB → ${savedKb}KB` : undefined });
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('Resize error:', err);
      toast({ title: 'Image processing failed', variant: 'destructive' });
    }
    setUploading(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadGallery = async () => {
    setLoadingGallery(true);
    const { data, error } = await supabase.storage.from(BUCKET).list('', {
      limit: 100,
      sortBy: { column: 'created_at', order: 'desc' },
    });

    if (error) {
      if (import.meta.env.DEV) console.error('Gallery error:', error);
      toast({ title: 'Error loading images', variant: 'destructive' });
    } else {
      const images: StorageImage[] = (data || [])
        .filter(f => f.name !== '.emptyFolderPlaceholder')
        .map(f => ({
          name: f.name,
          url: getPublicUrl(f.name),
          created_at: f.created_at || '',
        }));
      setGalleryImages(images);
    }
    setLoadingGallery(false);
  };

  const deleteImage = async (name: string) => {
    const { error } = await supabase.storage.from(BUCKET).remove([name]);
    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    } else {
      setGalleryImages(prev => prev.filter(img => img.name !== name));
      if (value && value.includes(name)) {
        onChange('');
      }
      toast({ title: 'Image deleted' });
    }
  };

  useEffect(() => {
    if (showGallery) loadGallery();
  }, [showGallery]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowGallery(!showGallery)} className="text-xs">
          <ImageIcon className="h-3 w-3 mr-1" />
          {showGallery ? 'Hide Gallery' : 'Image Gallery'}
        </Button>
      </div>

      {/* Current image preview */}
      {value && (
        <div className="relative group rounded-lg overflow-hidden border bg-gray-50">
          <img src={value} alt="Selected" className="w-full h-40 object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Drop zone */}
      {!value && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-gray-300 hover:border-primary/50 hover:bg-gray-50'
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <RefreshCw className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-gray-600">Uploading...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-gray-400" />
              <span className="text-sm text-gray-600">Drop an image here or click to browse</span>
              <span className="text-xs text-gray-400">JPEG, PNG, WebP, GIF — Max 5MB</span>
            </div>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Image Gallery */}
      {showGallery && (
        <div className="border rounded-lg p-3 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">Image Library</span>
            <Button type="button" size="sm" variant="ghost" onClick={loadGallery} disabled={loadingGallery}>
              <RefreshCw className={`h-3 w-3 ${loadingGallery ? 'animate-spin' : ''}`} />
            </Button>
          </div>
          {loadingGallery ? (
            <div className="flex justify-center py-4">
              <RefreshCw className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : galleryImages.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No images uploaded yet</p>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
              {galleryImages.map((img) => {
                const isSelected = value === img.url;
                return (
                  <div key={img.name} className="relative group">
                    <button
                      type="button"
                      onClick={() => onChange(img.url)}
                      className={`w-full aspect-square rounded border-2 overflow-hidden transition-all ${
                        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-primary/40'
                      }`}
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                          <Check className="h-5 w-5 text-white drop-shadow-lg" />
                        </div>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteImage(img.name); }}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-red-500 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Upload an image and return the public URL (for use in the RichTextEditor) */
export async function uploadImageToStorage(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) return null;
  try {
    const resizedBlob = await resizeImage(file, 1200, 800);
    const outExt = file.type === 'image/png' ? 'png' : 'jpg';
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${outExt}`;
    const { error } = await supabase.storage.from(BUCKET).upload(fileName, resizedBlob, {
      cacheControl: '3600',
      contentType: file.type === 'image/png' ? 'image/png' : 'image/jpeg',
    });
    if (error) return null;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName);
    return data.publicUrl;
  } catch {
    return null;
  }
}
