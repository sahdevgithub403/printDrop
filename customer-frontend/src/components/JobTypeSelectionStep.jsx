import React from "react";
import { FileText, UserSquare2, ChevronRight } from "lucide-react";

export const JobTypeSelectionStep = ({ onSelect }) => {
  return (
    <div className="space-y-6 max-w-lg mx-auto py-8">
      <div className="text-center space-y-2">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--text-primary)] tracking-tight">
          What do you want to print?
        </h2>
        <p className="text-base text-[var(--text-secondary)] font-medium">
          Select the type of print job you need.
        </p>
      </div>

      <div className="grid gap-4 mt-8">
        <button
          onClick={() => onSelect("DOCUMENT")}
          className="group text-left p-6 bg-[var(--bg-surface)] rounded-2xl border-2 border-[var(--border-app)] hover:border-[var(--color-accent)] hover:bg-[var(--bg-elevated)] transition-all flex items-center justify-between shadow-xs cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)] group-hover:scale-105 transition-transform">
              <FileText className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">
                Document Printing
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1 font-medium">
                Print PDFs, Word files, assignments, etc.
              </p>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-1 transition-all" />
        </button>

        <button
          onClick={() => onSelect("PASSPORT_PHOTO")}
          className="group text-left p-6 bg-[var(--bg-surface)] rounded-2xl border-2 border-[var(--border-app)] hover:border-[var(--color-accent)] hover:bg-[var(--bg-elevated)] transition-all flex items-center justify-between shadow-xs cursor-pointer"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-[var(--bg-subtle)] text-[var(--text-primary)] flex items-center justify-center shrink-0 border border-[var(--border-app)] group-hover:scale-105 transition-transform">
              <UserSquare2 className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">
                Passport Photo
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1 font-medium">
                Upload a photo and get passport size prints.
              </p>
            </div>
          </div>
          <ChevronRight className="w-6 h-6 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] group-hover:translate-x-1 transition-all" />
        </button>
      </div>
    </div>
  );
};
