// Fixtures for the Setup and Sources capability tests. Test support only.
import type { LiveSessionChoicesResponse } from "@omnitech/interview-contracts";
import { capabilityReport, minutesAfter } from "./session-fixtures";

export const CHOICES: LiveSessionChoicesResponse = {
  candidacies: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Staff Engineer",
      companyName: "Example Corp",
      createdAt: minutesAfter(0),
      interviews: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          label: "Recruiter screen",
          kind: "screening",
          scheduledAt: null,
        },
      ],
    },
  ],
  profiles: [
    {
      profileId: "main",
      name: "Main matrix",
      revision: 3,
      createdAt: minutesAfter(0),
      entryCount: 4,
      latest: true,
    },
  ],
};

export const REPORTS = {
  ready: capabilityReport(),
  unsupported: capabilityReport({ speech: { onDeviceAvailable: false } }),
  denied: capabilityReport({ speech: { authorizationStatus: "denied" } }),
  restricted: capabilityReport({
    speech: { authorizationStatus: "restricted" },
  }),
  recognizerDown: capabilityReport({ speech: { recognizerAvailable: false } }),
};
