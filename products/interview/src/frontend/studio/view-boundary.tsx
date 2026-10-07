import { Button } from "@oc-tech/omni-ui-components";
import { Component, type ReactNode } from "react";

// A crash in one view leaves the sidebar, palette and assistant usable.
export class ViewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="studio-page">
        <div className="studio-view-error" role="alert">
          <strong>This view hit an error.</strong>
          <Button
            variant="outline"
            onClick={() => this.setState({ failed: false })}
          >
            Reload view
          </Button>
        </div>
      </div>
    );
  }
}
