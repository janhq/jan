import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@janhq/interfaces/dialog";
import { Button } from "@janhq/interfaces/button";
import { Field, FieldError, FieldGroup } from "@janhq/interfaces/field";
import { Textarea } from "@janhq/interfaces/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useProjects } from "@/stores/projects-store";
import { useEffect } from "react";
import { useIsMobile } from "@janhq/interfaces/hooks/use-mobile";

const manageInstructionsSchema = z.object({
  instruction: z.string().optional(),
});

type ManageInstructionsFormData = z.infer<typeof manageInstructionsSchema>;

interface ManageInstructionsProps {
  open: boolean;
  project: Project | null;
  onSuccess?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export function ManageInstructions({
  open,
  project,
  onSuccess,
  onOpenChange,
}: ManageInstructionsProps) {
  const updateProject = useProjects((state) => state.updateProject);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
  } = useForm<ManageInstructionsFormData>({
    resolver: zodResolver(manageInstructionsSchema),
  });

  // Set initial value when project changes
  useEffect(() => {
    if (project) {
      setValue("instruction", project.instruction || "");
    }
  }, [project, setValue]);

  const handleClose = () => {
    onOpenChange?.(false);
  };

  const onSubmit = async (data: ManageInstructionsFormData) => {
    if (!project) return;

    try {
      await updateProject(project.id, {
        name: project.name,
        instruction: data.instruction || "",
      });
      reset();
      handleClose();
      onSuccess?.();
    } catch (error) {
      console.error("Failed to update project instructions:", error);
    }
  };

  const isMobile = useIsMobile();

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className="p-0 gap-0 overflow-hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => (isMobile ? e.preventDefault() : undefined)}
      >
        <DialogHeader className="px-6 py-4 border-b border-muted text-left">
          <DialogTitle className="font-medium">Manage Instructions</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col">
          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            <form onSubmit={handleSubmit(onSubmit)}>
              <FieldGroup>
                <Field>
                  <Textarea
                    id="instruction"
                    placeholder="Project instructions (optional)"
                    rows={6}
                    className="max-h-100"
                    autoFocus={isMobile ? false : true}
                    {...register("instruction")}
                  />
                  {errors.instruction && (
                    <FieldError>{errors.instruction.message}</FieldError>
                  )}
                </Field>

                <Field>
                  <div className="flex gap-2 justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full"
                      onClick={handleClose}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-full"
                    >
                      {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
