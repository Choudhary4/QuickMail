import { WizardController } from '@/components/wizard/WizardController';

export default function HomePage() {
  return (
    <main className="container mx-auto p-4 md:p-8">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold tracking-tight lg:text-5xl">QuickMail</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Send personalized emails instantly. No accounts, no tracking.
        </p>
      </div>
      
      <WizardController />
    </main>
  );
}