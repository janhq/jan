import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@janhq/interfaces/empty";
import { ShapesIcon } from "lucide-react";

export function AppsConnectorSettings() {
  return (
    <div>
      <p className="text-base font-medium mb-4 font-studio">
        Apps & connectors
      </p>
      <div className="mt-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon" className="text-muted-foreground">
              <ShapesIcon />
            </EmptyMedia>
            <EmptyTitle>Almost Ready</EmptyTitle>
            <EmptyDescription>
              We’re still working on this, check back soon.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    </div>
  );
}
