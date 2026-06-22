"use client";

import { useWizardStore } from '@/store/wizardStore';
import { StepSmtpConfig } from './01-StepSmtpConfig';
import { StepRecipients } from './02-StepRecipients';
import { StepEmailDesigner } from './03-StepEmailDesigner';
import { StepReviewSend } from './04-StepReviewSend';

export function WizardController() {
  // Get the current step and the function to change it from our Zustand store
  const { step, setStep } = useWizardStore();

  const handleNext = () => setStep(step + 1);
  const handleBack = () => setStep(step - 1);

  // --- THIS IS THE FIX ---
  // Define the container class based on the current step.
  // Step 3 (Email Designer) gets a wider container.
  const containerClass = step === 3 
    ? "max-w-7xl mx-auto transition-all duration-300" 
    : "max-w-4xl mx-auto transition-all duration-300";
  // --- END OF FIX ---

  const renderStep = () => {
    switch (step) {
      case 1:
        return <StepSmtpConfig onNext={handleNext} />;
      case 2:
        return <StepRecipients onNext={handleNext} onBack={handleBack} />;
      case 3:
        return <StepEmailDesigner onNext={handleNext} onBack={handleBack} />;
      case 4:
        return <StepReviewSend onBack={handleBack} />;
      default:
        // Default to step 1 if the state is somehow invalid
        return <StepSmtpConfig onNext={handleNext} />;
    }
  };

  return (
    // Use the dynamic class here
    <div className={containerClass}>
      {renderStep()}
    </div>
  );
}