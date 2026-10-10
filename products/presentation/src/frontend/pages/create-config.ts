export const referenceThemes = [
  {
    id: "indigo",
    name: "Indigo",
    fonts: "Poppins / Source Sans Pro",
    frame: "#818cf8",
    card: "#24205a",
    text: "#a5b4fc",
  },
  {
    id: "orbit",
    name: "Orbit",
    fonts: "Space Grotesk / IBM Plex Sans",
    frame: "#3d368f",
    card: "#f8f8f8",
    text: "#393185",
  },
  {
    id: "cosmos",
    name: "Cosmos",
    fonts: "Space Grotesk / IBM Plex Sans",
    frame: "#818cf8",
    card: "#01040e",
    text: "#818cf8",
  },
  {
    id: "piano",
    name: "Piano",
    fonts: "Playfair Display / Lora",
    frame: "#202833",
    card: "#f1f2f4",
    text: "#202833",
  },
  {
    id: "ebony",
    name: "Ebony",
    fonts: "Playfair Display / Lora",
    frame: "#e5e7eb",
    card: "#111827",
    text: "#f8fafc",
  },
  {
    id: "mystique",
    name: "Mystique",
    fonts: "Montserrat / Raleway",
    frame: "#7c3aed",
    card: "#ffffff",
    text: "#7c3aed",
  },
] as const;

export const referenceTextOptions = [
  { id: "minimal", name: "Minimal", lines: 2 },
  { id: "concise", name: "Concise", lines: 3 },
  { id: "detailed", name: "Detailed", lines: 3 },
  { id: "extensive", name: "Extensive", lines: 4 },
] as const;
