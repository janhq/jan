import {
  DropDrawerItem,
  DropDrawerSub,
  DropDrawerSubContent,
  DropDrawerSubTrigger,
} from "@janhq/interfaces/dropdrawer";
import { cn } from "@/lib/utils";
import { useProjects } from "@/stores/projects-store";
import { CircleCheck, FolderEdit, FolderIcon, LayoutGrid } from "lucide-react";
import { useEffect } from "react";

interface ProjectsChatInputProps {
  currentProjectId?: string;
  onProjectSelect?: (projectId: string) => void;
  title?: string;
}

export const ProjectsChatInput = ({
  currentProjectId,
  onProjectSelect,
  title = "Use a Project",
}: ProjectsChatInputProps) => {
  const { projects, getProjects, loading } = useProjects();

  useEffect(() => {
    getProjects();
  }, [getProjects]);

  return (
    <DropDrawerSub id="projects-submenu">
      <DropDrawerSubTrigger data-mobile-title="Select project">
        <div className="flex gap-2 items-center">
          <FolderEdit className="size-4 text-muted-foreground" />
          {title}
        </div>
      </DropDrawerSubTrigger>
      <DropDrawerSubContent
        className={cn(
          "w-64 max-h-80 overflow-auto",
          projects.length === 0 && "w-80",
        )}
      >
        {loading ? (
          <DropDrawerItem disabled>
            <div className="flex gap-2 items-center w-full">
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          </DropDrawerItem>
        ) : projects.length === 0 ? (
          <DropDrawerItem disabled className="h-40 px-4">
            <div className="flex items-center flex-col w-full justify-center text-center">
              <LayoutGrid className="size-6 text-muted-foreground mb-2" />
              <h3 className="font-medium  text-base">No projects created</h3>
              <span className="text-muted-foreground">
                Create a project to organize conversations and utilize memory.
              </span>
            </div>
          </DropDrawerItem>
        ) : (
          projects
            .filter((project) => !project.is_archived)
            .map((project) => (
              <DropDrawerItem
                key={project.id}
                onSelect={() => {
                  onProjectSelect?.(project.id);
                }}
              >
                <div className="flex gap-2 items-center justify-between w-full">
                  <div className="flex gap-2 items-center w-full">
                    <FolderIcon className="size-4 text-muted-foreground" />
                    <span>{project.name}</span>
                  </div>
                  {currentProjectId === project.id && (
                    <CircleCheck className="size-4 text-primary" />
                  )}
                </div>
              </DropDrawerItem>
            ))
        )}
      </DropDrawerSubContent>
    </DropDrawerSub>
  );
};
