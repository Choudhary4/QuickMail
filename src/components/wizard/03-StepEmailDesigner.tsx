// src/components/wizard/03-StepEmailDesigner.tsx
"use client";

import { useState } from 'react';
import { useWizardStore } from '@/store/wizardStore';
import { generateHtmlFromBlocks } from '../../lib/blockToHtml'; 

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Loader2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { CodeEditor } from './CodeEditor';
import { toast } from 'sonner';
import EmailBuilder from './EmailBuilder';

export function StepEmailDesigner({ onNext, onBack }: { onNext: () => void, onBack: () => void }) {
  const { 
    subject, setSubject, 
    htmlContent, setHtmlContent,
    editorMode, setEditorMode,
    // REFACTOR: Use the new block state
    emailBlocks, 
    headers
  } = useWizardStore();
  
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleCopyPlaceholder = (header: string) => {
    const placeholder = `{{${header}}}`;
    navigator.clipboard.writeText(placeholder);
    toast.success(`Placeholder "${placeholder}" copied to clipboard!`);
  };

  const handleModeChange = (mode: 'visual' | 'code') => {
    if (!mode || mode === editorMode) return;

    // REFACTOR: When switching to code mode, generate HTML from the visual builder
    if (mode === 'code' && emailBlocks.length > 0) {
        const generatedHtml = generateHtmlFromBlocks(emailBlocks);
        setHtmlContent(generatedHtml);
        toast.info("Switched to Code Editor. Your visual design has been converted to HTML.");
    }

    setEditorMode(mode);
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) {
      toast.error("Please enter a description for the AI.");
      return;
    }
    setIsGenerating(true);
    try {
      const response = await fetch('/api/generate-html', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate HTML from the server.');
      }

      const data = await response.json();
      setHtmlContent(data.html); // Update the global store with the new HTML
      toast.success("AI has generated your email HTML!");

    } catch (error) {
      console.error(error);
      toast.error("An error occurred while generating the email.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Step 3: Design Your Email</CardTitle>
        <CardDescription>Use the Block-based Designer or switch to the Code Editor for full control.</CardDescription>
      </CardHeader>
      <CardContent>
        <Input id="subject" placeholder="Email Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mb-4" />
        
        {headers.length > 0 && (
          <div className="mb-4 space-y-2">
            <Label>Click to copy a placeholder:</Label>
            <div className="flex flex-wrap gap-2">
              {headers.map((header) => (
                <Badge key={header} variant="outline" className="cursor-pointer" onClick={() => handleCopyPlaceholder(header)}>
                  {`{{${header}}}`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <ToggleGroup type="single" value={editorMode} onValueChange={handleModeChange} className="w-full mb-4">
          <ToggleGroupItem value="visual" className="w-1/2">Visual Designer</ToggleGroupItem>
          <ToggleGroupItem value="code" className="w-1/2">Code Editor</ToggleGroupItem>
        </ToggleGroup>

        {editorMode === 'visual' ? (
           // REFACTOR: The visual mode now just renders the complete EmailBuilder component.
           <EmailBuilder/>
        ) : (
          <div>
            <div className="mb-4 space-y-2">
                <Label htmlFor="ai-prompt">Describe the email you want to build</Label>
                <Textarea
                  id="ai-prompt"
                  placeholder="e.g., A welcome email for a new user with a logo, a personalized greeting, and a large blue call-to-action button that says 'Get Started'."
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                  disabled={isGenerating}
                />
                <Button onClick={handleAiGenerate} disabled={isGenerating || !aiPrompt} className="w-full">
                  {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {isGenerating ? 'Generating...' : 'Generate with AI'}
                </Button>
              </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <CodeEditor />
            <div className="space-y-2">
              <Label>Live Preview</Label>
              <div className="border rounded-md h-[800px] overflow-hidden bg-white">
                  <iframe srcDoc={htmlContent} title="Email Preview" className="w-full h-full border-0" />
              </div>
            </div>
          </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onNext} disabled={!subject}>Next</Button>
      </CardFooter>
    </Card>
  );
}