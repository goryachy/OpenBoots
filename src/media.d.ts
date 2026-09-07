interface MediaTrackConstraintSet {
  /** Supported by mobile camera implementations but missing from older lib.dom typings. */
  focusMode?: string | { ideal?: string; exact?: string };
}
