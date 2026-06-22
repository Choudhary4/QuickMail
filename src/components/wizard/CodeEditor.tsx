// src/components/wizard/CodeEditor.tsx
"use client";

import { useWizardStore } from "@/store/wizardStore";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CodeEditor() {
    const { htmlContent, setHtmlContent } = useWizardStore();

    return (
        <div className="space-y-2">
            <Label htmlFor="html-content">HTML Code Editor</Label>
            <Textarea
              id="html-content"
              className="min-h-[400px] max-h-[800px] font-mono text-sm "
              placeholder="<html>...</html>"
              value={htmlContent}
              onChange={(e) => setHtmlContent(e.target.value)}
            />
        </div>
    );
}