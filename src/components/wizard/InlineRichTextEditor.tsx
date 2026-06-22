// src/components/wizard/InlineRichTextEditor.tsx
"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {TextStyle} from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Button } from '@/components/ui/button';
import { Bold, Italic } from 'lucide-react';
import { useState, useEffect } from 'react';

interface InlineRichTextEditorProps {
    initialContent: string;
    onUpdate: (html: string) => void;
    onBlur: () => void;
}

export function InlineRichTextEditor({ initialContent, onUpdate, onBlur }: InlineRichTextEditorProps) {
    // --- State to manage our manual bubble menu ---
    const [menu, setMenu] = useState<{ top: number, left: number, isVisible: boolean } | null>(null);

    const editor = useEditor({
        extensions: [
            StarterKit,
            TextStyle,
            Color,
        ],
        content: initialContent,
        autofocus: true,
        onUpdate: ({ editor }) => {
            onUpdate(editor.getHTML());
        },
        onBlur: () => {
            onBlur();
            // Hide menu when editor loses focus
            setMenu(prev => prev ? { ...prev, isVisible: false } : null);
        },
        editorProps: {
            attributes: {
                class: 'focus:outline-none w-full h-full',
            },
        },
        immediatelyRender: false,
    });

    // --- This is the core logic for our manual bubble menu ---
    useEffect(() => {
        if (!editor) return;

        const handleSelectionUpdate = () => {
            const { state } = editor;
            const { from, to } = state.selection;
            const isTextSelected = from !== to;

            if (isTextSelected) {
                // Get the screen coordinates of the selected text
                const coords = editor.view.coordsAtPos(from);
                setMenu({
                    left: coords.left,
                    top: coords.top - 40, // Position it just above the selection
                    isVisible: true,
                });
            } else {
                // If no text is selected, hide the menu
                setMenu(prev => prev ? { ...prev, isVisible: false } : null);
            }
        };

        // Listen for changes in the editor's selection
        editor.on('selectionUpdate', handleSelectionUpdate);
        
        // Clean up the event listener when the component unmounts
        return () => {
            editor.off('selectionUpdate', handleSelectionUpdate);
        };
    }, [editor]);
    
    if (!editor) { return null; }

    return (
        <>
            {/* --- Render our manual bubble menu conditionally --- */}
            {menu?.isVisible && (
                <div 
                    className="flex bg-background border rounded-md shadow-lg p-1 gap-1"
                    style={{
                        position: 'fixed', // Use fixed positioning relative to the viewport
                        top: `${menu.top}px`,
                        left: `${menu.left}px`,
                        zIndex: 100,
                    }}
                >
                    <Button size="sm" variant={editor.isActive('bold') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleBold().run()}>
                        <Bold className="h-4 w-4"/>
                    </Button>
                    <Button size="sm" variant={editor.isActive('italic') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleItalic().run()}>
                        <Italic className="h-4 w-4"/>
                    </Button>
                    <input
                        type="color"
                        onInput={(event: React.ChangeEvent<HTMLInputElement>) => editor.chain().focus().setColor(event.target.value).run()}
                        value={editor.getAttributes('textStyle').color || '#000000'}
                        className="w-8 h-8 p-1 bg-transparent border-none cursor-pointer"
                        title="Text Color"
                    />
                </div>
            )}
            
            <EditorContent editor={editor} />
        </>
    );
}