import type { SVGProps } from "react"

/**
 * A visually altered version of the Cline logo to represent a "disconnected" state,
 * featuring 'X's for eyes to symbolize a connection error. The 'X's are cut out
 * from the main shape to reveal the background.
 */
export const ClineLogoDisconnected = (props: SVGProps<SVGSVGElement>) => (
	<svg xmlns="http://www.w3.org/2000/svg" width="47" height="50" viewBox="0 0 47 50" fill="none" {...props}>
		<defs>
			<mask id="eye-mask">
				{/* Start with a white rectangle, making everything visible by default */}
				<rect x="0" y="0" width="47" height="50" fill="white" />
				{/* Draw the 'X's in black to "cut them out" (make them transparent) */}
				<path d="M12.5 23 L 19.5 34 M 19.5 23 L 12.5 34" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
				<path d="M27.5 23 L 34.5 34 M 34.5 23 L 27.5 34" stroke="black" strokeWidth="2.5" strokeLinecap="round" />
			</mask>
		</defs>

		{/* Main Outline, with the mask applied */}
		<path
			d="M46.4075 28.1192L43.5011 22.3166V18.9747C43.5011 13.4354 39.0302 8.94931 33.5162 8.94931H28.5491C28.9086 8.21513 29.106 7.3898 29.106 6.5189C29.106 3.44039 26.6149 0.949219 23.5363 0.949219C20.4578 0.949219 17.9667 3.44039 17.9667 6.5189C17.9667 7.3898 18.1641 8.21513 18.5236 8.94931H13.5565C8.04249 8.94931 3.57155 13.4354 3.57155 18.9747V22.3166L0.604424 28.104C0.305687 28.6863 0.305687 29.3799 0.604424 29.9622L3.57155 35.6838V39.0256C3.57155 44.5649 8.04249 49.0511 13.5565 49.0511H33.5162C39.0302 49.0511 43.5011 44.5649 43.5011 39.0256V35.6838L46.4024 29.942C46.691 29.3698 46.691 28.6964 46.4075 28.1192Z"
			fill="currentColor"
			mask="url(#eye-mask)"
		/>
	</svg>
)

export default ClineLogoDisconnected
