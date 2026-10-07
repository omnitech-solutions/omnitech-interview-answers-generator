// When a log counts as "at the end". The transcript follows its newest line
// until the person scrolls away and then offers a way back; that behaviour is the
// library Panel's (`scroll.stickToBottom`, same 48 px rule), and this is the
// rule the app pins.

// Within this many px of the end still counts as "at the end".
export const AT_END_PX = 48;

export const isAtEnd = (box: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean => box.scrollHeight - box.scrollTop - box.clientHeight <= AT_END_PX;
