import styles from './assistant.module.css'

export type IsagiVision = 'normal' | 'meta' | 'omni'
export type IsagiMotion = 'idle' | 'walking'

export interface IsagiAvatarProps {
  vision?: IsagiVision
  motion?: IsagiMotion
}

/**
 * Original vector fan illustration based on Isagi's navy fringe and #11 kit.
 * Omni is this app's white/glowing visual interpretation, not a canon claim.
 */
function IsagiFigure({ vision }: { vision: IsagiVision }) {
  return (
    <svg
      viewBox="0 0 160 206"
      className={`${styles.character} ${vision === 'omni' ? styles.evolvedCharacter : vision === 'meta' ? styles.metaCharacter : ''}`}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="80" cy="197" rx="38" ry="5" className={styles.ground} />
      <g className={styles.figureBody}>
        {/* Individually articulated limbs create an actual alternating stride. */}
        <g className={styles.leftLeg}>
          <path d="m60 161-2 23-9 8q-2 5 5 5h17l5-33" className={styles.boots} />
          <path d="m59 158-1 21 15 1 4-21" className={styles.socks} />
          <path d="m55 139 1 26 21 2 3-16v-12" className={styles.shorts} />
          <path d="m54 191 12-1" className={styles.bootStripe} />
        </g>
        <g className={styles.rightLeg}>
          <path d="m86 164 5 33h18q7-1 3-6l-9-8-2-23" className={styles.boots} />
          <path d="m84 159 4 21 15-1-2-21" className={styles.socks} />
          <path d="m80 139 4 28 21-2 1-26" className={styles.shorts} />
          <path d="m96 190 12 1" className={styles.bootStripe} />
        </g>
        <g className={styles.leftArm}>
          <path d="m54 104-18 14 10 22 13-8" className={styles.sleeves} />
          <path d="m40 130-4 17q-1 8 6 9 6 1 7-6l5-17" className={styles.skin} />
          <path d="m39 147 6 2" className={styles.mouth} />
        </g>
        <g className={styles.rightArm}>
          <path d="m106 104 18 14-10 22-13-8" className={styles.sleeves} />
          <path d="m106 133 5 17q1 7 7 6 7-1 6-9l-4-17" className={styles.skin} />
          <path d="m115 149 6-2" className={styles.mouth} />
        </g>
        <g className={styles.torso}>
          <path d="m60 99 20 8 20-8 9 47q-27 9-58 0z" className={styles.jersey} />
          <path d="m62 103 9 8-5 36-12-2 5-35m40-7-10 8 5 36 12-2-5-35" className={styles.kitPanel} />
          <path d="m70 97 10 9 10-9v11l-10 8-10-8z" className={styles.collar} />
          <path d="M73 121h5v17h-5zm10 0h5v17h-5z" className={styles.number} />
          <path d="m100 111 4 2-1 5-4-2z" className={styles.number} />
          <path d="M72 90v14q8 8 16 0V90" className={styles.skin} />
        </g>
        <g className={styles.head}>
          <path d="M39 58q-8-1-7 9 0 10 10 11m79-20q8-1 7 9 0 10-10 11" className={styles.skin} />
          <path d="M39 46q1-29 41-30 41 1 41 30v25q-3 24-41 33-38-9-41-33z" className={styles.skin} />
          <path d="m41 68 8 15 7-1m63-14-8 15-7-1" className={styles.faceShade} />
          <g className={styles.eyes}>
            <path d="M48 61q12-9 24 0l-2 15q-9 7-20-1zm40 0q12-9 24 0l-2 14q-11 8-20 1z" className={styles.eyeWhite} />
            <ellipse cx="61" cy="67" rx="7" ry="11" className={styles.iris} />
            <ellipse cx="99" cy="67" rx="7" ry="11" className={styles.iris} />
            <ellipse cx="62" cy="68" rx="3" ry="7" className={styles.pupil} />
            <ellipse cx="98" cy="68" rx="3" ry="7" className={styles.pupil} />
            <path d="M58 60h3v5h-3zm37 0h3v5h-3z" className={styles.eyeWhite} />
          </g>
          <path d="m47 59 25-2m16 0 25 2" className={styles.inkLine} />
          <path d="m76 80 4 2m-7 8q7 4 14-1" className={styles.mouth} />
          <path d="m32 63-5-23 8 1-5-17 15 2-2-15 19 8L69 5l12 11L97 7l3 15 17-5-1 14 16 2-6 14 6 13-13 15-5-25-9 8-7-21-6 14-14-17 1 22-19-14-6 19-8-10-6 20-7-8z" className={styles.hair} />
          <path d="m42 33 16-7-5 13m18-17 9 12m18-7 9 10m-48 3 8 6" className={styles.hairLight} />
          {vision === 'meta' ? (
            <g className={styles.metaEyes}>
              {/* Radar rings are interrupted by Isagi's interlocking puzzle motif. */}
              <circle cx="61" cy="67" r="10" /><circle cx="99" cy="67" r="10" />
              <circle cx="61" cy="67" r="6" /><circle cx="99" cy="67" r="6" />
              <path d="M51 66h5q-2-5 2-5t2 5h11M61 57v5q5-2 5 2t-5 2v11M89 68h5q-2 5 2 5t2-5h11M99 57v5q-5-2-5 2t5 2v11" />
              <path d="m54 60 3 3m8 8 3 3m24-14 3 3m8 8 3 3" />
            </g>
          ) : vision === 'omni' ? (
            <g className={styles.omniEyes}>
              <ellipse cx="61" cy="67" rx="12" ry="5" transform="rotate(-25 61 67)" />
              <ellipse cx="99" cy="67" rx="12" ry="5" transform="rotate(25 99 67)" />
              <path d="m61 56 2 8 7 3-7 2-2 9-2-9-7-2 7-3zm38 0 2 8 7 3-7 2-2 9-2-9-7-2 7-3z" className={styles.omniPupils} />
              <path d="m47 69-5 2m28-15 3-4m12 4-3-4m30 17 5 2" />
            </g>
          ) : null}
        </g>
      </g>
    </svg>
  )
}

export function IsagiAvatar({ vision = 'normal', motion = 'idle' }: IsagiAvatarProps) {
  return (
    <span className={styles.avatarArt} data-vision={vision} data-motion={motion}>
      <span className={styles.aura} />
      <span className={styles.visionRing} />
      <span className={styles.omniOrbit} />
      <span className={styles.puzzleFragments} aria-hidden="true"><i /><i /><i /><i /></span>
      <span className={styles.normalFigure}><IsagiFigure vision="normal" /></span>
      <span className={styles.metaFigure}><IsagiFigure vision="meta" /></span>
      <span className={styles.visionFigure}><IsagiFigure vision="omni" /></span>
      <span className={styles.visionSpark} />
    </span>
  )
}
