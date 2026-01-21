import { Atom } from "@effect-atom/atom";

export const queryAtom = Atom.make("").pipe(Atom.withLabel("app.query"));
export const cmdkOpenAtom = Atom.make(false).pipe(Atom.withLabel("app.cmdkOpen"));
export const cmdkQueryAtom = Atom.make("").pipe(Atom.withLabel("app.cmdkQuery"));
export const helpOpenAtom = Atom.make(false).pipe(Atom.withLabel("app.helpOpen"));
export const debugModeAtom = Atom.make(false).pipe(Atom.withLabel("app.debugMode"));
export const debugToastAtom = Atom.make("").pipe(Atom.withLabel("app.debugToast"));
export const debugToastVisibleAtom = Atom.make(false).pipe(Atom.withLabel("app.debugToastVisible"));
export const activeViewAtom = Atom.make("main").pipe(Atom.withLabel("app.activeView"));
