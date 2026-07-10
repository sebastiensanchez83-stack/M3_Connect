import { useState, DragEvent } from 'react';

// Drag-and-drop for any upload area. Returns an `isDragging` flag (for a
// highlight) and spreadable handlers to put on the drop target — pairs with a
// hidden <input type="file"> + click-to-choose so both gestures work.
export function useFileDrop(onFiles: (files: File[]) => void, disabled = false) {
  const [isDragging, setIsDragging] = useState(false);
  const dropHandlers = {
    onDragOver: (e: DragEvent) => { e.preventDefault(); if (!disabled) setIsDragging(true); },
    onDragEnter: (e: DragEvent) => { e.preventDefault(); if (!disabled) setIsDragging(true); },
    onDragLeave: (e: DragEvent) => { e.preventDefault(); setIsDragging(false); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) onFiles(files);
    },
  };
  return { isDragging, dropHandlers };
}
