"use client";
/* eslint-disable react-refresh/only-export-components */

import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { useTranslation } from "@/i18n/react-i18next-compat";
import { mergeButtonRefs } from "@/lib/merge-button-refs";
import { cn } from "@/lib/utils";

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "15rem";
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "5rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

//* new constants for sidebar resizing
const MIN_SIDEBAR_WIDTH = "14rem";
const MAX_SIDEBAR_WIDTH = "20rem";

type SidebarContext = {
	state: "expanded" | "collapsed";
	open: boolean;
	setOpen: (open: boolean) => void;
	openMobile: boolean;
	setOpenMobile: (open: boolean) => void;
	isMobile: boolean;
	/** `opener` is the control that was activated; focus returns there on close. */
	toggleSidebar: (opener?: HTMLElement | null) => void;
	//* new properties for sidebar resizing
	width: string;
	setWidth: (width: string) => void;
	//* new properties for tracking is dragging rail
	isDraggingRail: boolean;
	setIsDraggingRail: (isDraggingRail: boolean) => void;
	//* element to refocus when the mobile overlay closes
	mobileReturnFocusRef: React.MutableRefObject<HTMLElement | null>;
};

const SidebarContext = React.createContext<SidebarContext | null>(null);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) {
		throw new Error("useSidebar must be used within a SidebarProvider.");
	}

	return context;
}

/** Like useSidebar, but null outside a provider (isolated header renders). */
function useOptionalSidebar() {
	return React.useContext(SidebarContext);
}

/**
 * Where focus lands when the mobile navigation overlay closes: the control that
 * opened it, or any visible sidebar toggle if that control was re-rendered away
 * (for example by the navigation the overlay just performed).
 */
function isRenderedVisible(element: HTMLElement) {
	if (!element.isConnected) return false;
	for (let node: HTMLElement | null = element; node; node = node.parentElement) {
		if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
		const style = window.getComputedStyle(node);
		if (style.display === "none" || style.visibility === "hidden") return false;
	}
	return true;
}

function restoreMobileFocus(opener: HTMLElement | null) {
	const target =
		opener && isRenderedVisible(opener)
			? opener
			: Array.from(
					document.querySelectorAll<HTMLElement>("[data-sidebar-toggle]"),
				).find(isRenderedVisible);
	target?.focus();
}

const SidebarProvider = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div"> & {
		defaultOpen?: boolean;
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
		//* new prop for default width
		defaultWidth?: string;
		/**
		 * Register the built-in Cmd/Ctrl+B listener. Apps that own the shortcut
		 * elsewhere (configurable KeyboardShortcutsProvider) pass `false`.
		 */
		keyboardShortcut?: boolean;
		//* new prop for width change callback
		onWidthChange?: (width: string) => void;
	}
>(
	(
		{
			defaultOpen = true,
			open: openProp,
			onOpenChange: setOpenProp,
			className,
			style,
			children,
			defaultWidth = SIDEBAR_WIDTH,
			onWidthChange,
			keyboardShortcut = true,
			...props
		},
		ref,
	) => {
		const isMobile = useIsMobile();
		//* new state for sidebar width
		const [width, setWidthState] = React.useState(defaultWidth);

		//* wrapper to call both internal state and external callback
		const setWidth = React.useCallback((newWidth: string) => {
			setWidthState(newWidth);
			onWidthChange?.(newWidth);
		}, [onWidthChange]);
		const [openMobile, setOpenMobileState] = React.useState(false);
		const mobileReturnFocusRef = React.useRef<HTMLElement | null>(null);
		// An explicit opener (the control that was activated) always wins over
		// document.activeElement, which may be an unrelated field such as the composer.
		const openMobileFrom = React.useCallback(
			(value: boolean, opener?: HTMLElement | null) => {
				if (value) {
					const active = document.activeElement;
					if (opener) mobileReturnFocusRef.current = opener;
					else if (active instanceof HTMLElement && active !== document.body)
						mobileReturnFocusRef.current = active;
				}
				setOpenMobileState(value);
			},
			[],
		);
		const setOpenMobile = React.useCallback(
			(value: boolean) => openMobileFrom(value),
			[openMobileFrom],
		);
		// An overlay left open while the window grows to the desktop layout must
		// not pop back open when it shrinks again.
		React.useEffect(() => {
			if (!isMobile) setOpenMobileState(false);
		}, [isMobile]);
		//* new state for tracking is dragging rail
		const [isDraggingRail, setIsDraggingRail] = React.useState(false);

		// This is the internal state of the sidebar.
		// We use openProp and setOpenProp for control from outside the component.
		const [_open, _setOpen] = React.useState(defaultOpen);
		const open = openProp ?? _open;
		const setOpen = React.useCallback(
			(value: boolean | ((value: boolean) => boolean)) => {
				const openState = typeof value === "function" ? value(open) : value;
				if (setOpenProp) {
					setOpenProp(openState);
				} else {
					_setOpen(openState);
				}

				// This sets the cookie to keep the sidebar state.
				document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
			},
			[setOpenProp, open],
		);

		// Helper to toggle the sidebar.
		const toggleSidebar = React.useCallback(
			(opener?: HTMLElement | null) => {
				if (!isMobile) return setOpen((open) => !open);
				// WebKit does not focus buttons on click, so the activated control is
				// passed in rather than read from document.activeElement.
				openMobileFrom(!openMobile, opener);
			},
			[isMobile, setOpen, openMobileFrom, openMobile],
		);

		// Adds a keyboard shortcut to toggle the sidebar.
		React.useEffect(() => {
			if (!keyboardShortcut) return;
			const handleKeyDown = (event: KeyboardEvent) => {
				if (
					event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
					(event.metaKey || event.ctrlKey)
				) {
					event.preventDefault();
					toggleSidebar();
				}
			};

			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}, [toggleSidebar, keyboardShortcut]);

		// We add a state so that we can do data-state="expanded" or "collapsed".
		// This makes it easier to style the sidebar with Tailwind classes.
		const state = open ? "expanded" : "collapsed";

		const contextValue = React.useMemo<SidebarContext>(
			() => ({
				state,
				open,
				setOpen,
				isMobile,
				openMobile,
				setOpenMobile,
				toggleSidebar,
				//* new context for sidebar resizing
				width,
				setWidth,
				//* new context for tracking is dragging rail
				isDraggingRail,
				setIsDraggingRail,
				mobileReturnFocusRef,
			}),
			[
				state,
				open,
				setOpen,
				isMobile,
				openMobile,
				setOpenMobile,
				toggleSidebar,
				width,
				setWidth,
				isDraggingRail,
				setIsDraggingRail,
			],
		);

		return (
			<SidebarContext.Provider value={contextValue}>
				<TooltipProvider delayDuration={0}>
					<div
						style={
							{
								// * update '--sidebar-width' to use the new width state
								"--sidebar-width": width,
								"--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
								...style,
							} as React.CSSProperties
						}
						className={cn(
							"group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
							className,
						)}
						ref={ref}
						{...props}
					>
						{children}
					</div>
				</TooltipProvider>
			</SidebarContext.Provider>
		);
	},
);
SidebarProvider.displayName = "SidebarProvider";

const Sidebar = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div"> & {
		side?: "left" | "right";
		variant?: "sidebar" | "floating" | "inset";
		collapsible?: "offcanvas" | "icon" | "none";
	}
>(
	(
		{
			side = "left",
			variant = "sidebar",
			collapsible = "offcanvas",
			className,
			children,
			...props
		},
		ref,
	) => {
		const {
			isMobile,
			state,
			openMobile,
			setOpenMobile,
			//* new property for tracking is dragging rail
			isDraggingRail,
			mobileReturnFocusRef,
		} = useSidebar();
		const { t } = useTranslation();

		if (collapsible === "none") {
			return (
				<div
					className={cn(
						"flex h-full w-(--sidebar-width) flex-col bg-clip-padding bg-linear-to-b from-sidebar dark:from-sidebar/70 to-background text-sidebar-foreground",
						className,
					)}
					ref={ref}
					{...props}
				>
					{children}
				</div>
			);
		}

		if (isMobile) {
			return (
				<Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
					<SheetContent
						data-sidebar="sidebar"
						data-mobile="true"
						className="w-(--sidebar-width) bg-clip-padding bg-linear-to-b from-sidebar dark:from-sidebar/70 to-background p-0 text-sidebar-foreground [&>button]:hidden"
						style={
							{
								"--sidebar-width": SIDEBAR_WIDTH_MOBILE,
							} as React.CSSProperties
						}
						side={side}
						onCloseAutoFocus={(event) => {
							// Radix only refocuses a Sheet.Trigger; the sidebar is opened
							// from toggle buttons elsewhere, so return focus explicitly.
							event.preventDefault();
							restoreMobileFocus(mobileReturnFocusRef.current);
						}}
					>
						<SheetTitle className="sr-only">
							{t("common:sidebar.navigation")}
						</SheetTitle>
						<SheetDescription className="sr-only">
							{t("common:sidebar.navigationDescription")}
						</SheetDescription>
						<div className="flex h-full w-full flex-col">{children}</div>
					</SheetContent>
				</Sheet>
			);
		}

		return (
			<div
				ref={ref}
				className="group peer hidden md:block text-sidebar-foreground"
				data-state={state}
				data-collapsible={state === "collapsed" ? collapsible : ""}
				data-variant={variant}
				data-side={side}
				//* add data-dragging attribute
				data-dragging={isDraggingRail}
			>
				{/* This is what handles the sidebar gap on desktop */}
				<div
					className={cn(
						"duration-200 relative h-svh w-(--sidebar-width) bg-transparent transition-[width] ease-linear",
						"group-data-[collapsible=offcanvas]:w-0",
						"group-data-[side=right]:rotate-180",
						variant === "floating" || variant === "inset"
							? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
							: "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
						//* set duration to 0 for all elements when dragging
						"group-data-[dragging=true]:duration-0! group-data-[dragging=true]_*:duration-0!",
					)}
				/>
				<div
					className={cn(
						"duration-200 fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] ease-linear md:flex",
						side === "left"
							? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
							: "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
						// Adjust the padding for floating and inset variants.
						variant === "floating" || variant === "inset"
							? "p-2 pr-0 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
							: "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
						//* set duration to 0 for all elements when dragging
						"group-data-[dragging=true]:duration-0! group-data-[dragging=true]_*:duration-0!",
						className,
					)}
					{...props}
				>
					<div
						data-sidebar="sidebar"
						className="flex bg-clip-padding h-full w-full flex-col bg-linear-to-b from-sidebar dark:from-sidebar/70 to-background group-data-[variant=floating]:rounded-xl group-data-[variant=floating]:shadow group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border"
					>
						{children}
					</div>
				</div>
			</div>
		);
	},
);
Sidebar.displayName = "Sidebar";

const SidebarTrigger = React.forwardRef<
	React.ElementRef<typeof Button>,
	React.ComponentProps<typeof Button>
>(({ className, onClick, ...props }, ref) => {
	const { toggleSidebar, isMobile, openMobile, open } = useSidebar();
	const { t } = useTranslation();

	return (
		<Button
			ref={ref}
			data-sidebar="trigger"
			data-sidebar-toggle="sidebar"
			aria-expanded={isMobile ? openMobile : open}
			variant="ghost"
			size="icon"
			className={cn("size-8", className)}
			onClick={(event) => {
				onClick?.(event);
				toggleSidebar(event.currentTarget);
			}}
			{...props}
		>
			<PanelLeft />
			<span className="sr-only">{t("common:sidebar.toggle")}</span>
		</Button>
	);
});
SidebarTrigger.displayName = "SidebarTrigger";

const SidebarRail = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<"button"> & {
		//* new prop for enabling drag
		enableDrag?: boolean;
	}
>(({ className, enableDrag = true, ...props }, ref) => {
	const { toggleSidebar, setWidth, state, width, setIsDraggingRail } =
		useSidebar();
	const { t } = useTranslation();

	const { dragRef, handleMouseDown } = useSidebarResize({
		direction: "right",
		enableDrag,
		onResize: setWidth,
		onToggle: toggleSidebar,
		currentWidth: width,
		isCollapsed: state === "collapsed",
		minResizeWidth: MIN_SIDEBAR_WIDTH,
		maxResizeWidth: MAX_SIDEBAR_WIDTH,
		setIsDraggingRail,
		widthCookieName: "sidebar:width",
		widthCookieMaxAge: 60 * 60 * 24 * 7, // 1 week
	});

	//* Merge external ref with our dragRef
	const combinedRef = React.useMemo(
		() => mergeButtonRefs([ref, dragRef]),
		[ref, dragRef],
	);

	return (
		<button
			//* updated ref to use combinedRef
			ref={combinedRef}
			data-sidebar="rail"
			aria-label={t("common:sidebar.toggle")}
			tabIndex={-1}
			// onClick={toggleSidebar}
			//* replace onClick with onMouseDown
			onMouseDown={handleMouseDown}
			title={t("common:sidebar.toggle")}
			className={cn(
				"absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 hover:after:bg-sidebar group-data-[side=left]:-right-4 group-data-[side=right]:left-0 sm:flex",
				// Cursor styles for resize
				"cursor-ew-resize group-data-[side=left]:cursor-ew-resize group-data-[side=right]:cursor-ew-resize",
				"[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
				"group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full hover:group-data-[collapsible=offcanvas]:bg-sidebar",
				"[[data-side=left][data-collapsible=offcanvas]_&]:-right-1",
				"[[data-side=right][data-collapsible=offcanvas]_&]:-left-1",
				// Adjust for floating variant - match the rounded corners and padding
				"group-data-[variant=floating]:inset-y-2 group-data-[side=left]:group-data-[variant=floating]:-right-4 group-data-[variant=floating]:after:rounded-lg group-data-[variant=floating]:mt-4 group-data-[variant=floating]:h-[calc(100%-4rem)]",
				className,
			)}
			{...props}
		/>
	);
});
SidebarRail.displayName = "SidebarRail";

const SidebarInset = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"main">
>(({ className, ...props }, ref) => {
	return (
		<main
			ref={ref}
			className={cn(
				// min-w-0 prevents flex-1 children from expanding beyond the flex container
				// when they contain non-breakable content (e.g. long URLs without whitespace).
				"relative flex min-h-svh flex-1 flex-col bg-background min-w-0",
				"peer-data-[variant=inset]:min-h-[calc(100svh-(--spacing(4)))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm",
				className,
			)}
			{...props}
		/>
	);
});
SidebarInset.displayName = "SidebarInset";

const SidebarInput = React.forwardRef<
	React.ElementRef<typeof Input>,
	React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => {
	return (
		<Input
			ref={ref}
			data-sidebar="input"
			className={cn(
				"h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
				className,
			)}
			{...props}
		/>
	);
});
SidebarInput.displayName = "SidebarInput";

const SidebarHeader = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
	return (
		<div
			ref={ref}
			data-sidebar="header"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
});
SidebarHeader.displayName = "SidebarHeader";

const SidebarFooter = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
	return (
		<div
			ref={ref}
			data-sidebar="footer"
			className={cn("flex flex-col gap-2 p-2", className)}
			{...props}
		/>
	);
});
SidebarFooter.displayName = "SidebarFooter";

const SidebarSeparator = React.forwardRef<
	React.ElementRef<typeof Separator>,
	React.ComponentProps<typeof Separator>
>(({ className, ...props }, ref) => {
	return (
		<Separator
			ref={ref}
			data-sidebar="separator"
			className={cn("mx-2 w-auto bg-sidebar-border", className)}
			{...props}
		/>
	);
});
SidebarSeparator.displayName = "SidebarSeparator";

const SidebarContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
	return (
		<div
			ref={ref}
			data-sidebar="content"
			className={cn(
				"flex min-h-0 flex-1 flex-col overflow-auto group-data-[collapsible=icon]:overflow-hidden",
				className,
			)}
			{...props}
		/>
	);
});
SidebarContent.displayName = "SidebarContent";

const SidebarGroup = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => {
	return (
		<div
			ref={ref}
			data-sidebar="group"
			className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
			{...props}
		/>
	);
});
SidebarGroup.displayName = "SidebarGroup";

const SidebarGroupLabel = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : "div";

	return (
		<Comp
			ref={ref}
			data-sidebar="group-label"
			className={cn(
				"duration-200 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
				"group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0",
				className,
			)}
			{...props}
		/>
	);
});
SidebarGroupLabel.displayName = "SidebarGroupLabel";

const SidebarGroupAction = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<"button"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			ref={ref}
			data-sidebar="group-action"
			className={cn(
				"absolute right-3 top-3.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
				// Increases the hit area of the button on mobile.
				"after:absolute after:-inset-2 md:after:hidden",
				"group-data-[collapsible=icon]:hidden",
				className,
			)}
			{...props}
		/>
	);
});
SidebarGroupAction.displayName = "SidebarGroupAction";

const SidebarGroupContent = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		data-sidebar="group-content"
		className={cn("w-full text-sm", className)}
		{...props}
	/>
));
SidebarGroupContent.displayName = "SidebarGroupContent";

const SidebarMenu = React.forwardRef<
	HTMLUListElement,
	React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
	<ul
		ref={ref}
		data-sidebar="menu"
		className={cn("flex w-full min-w-0 flex-col gap-1", className)}
		{...props}
	/>
));
SidebarMenu.displayName = "SidebarMenu";

const SidebarMenuItem = React.forwardRef<
	HTMLLIElement,
	React.ComponentProps<"li">
>(({ className, ...props }, ref) => (
	<li
		ref={ref}
		data-sidebar="menu-item"
		className={cn("group/menu-item relative", className)}
		{...props}
	/>
));
SidebarMenuItem.displayName = "SidebarMenuItem";

const sidebarMenuButtonVariants = cva(
	"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "hover:bg-sidebar-foreground/8 hover:text-sidebar-accent-foreground",
				outline:
					"bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
			},
			size: {
				default: "h-8 text-sm",
				sm: "h-7 text-xs",
				lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

const SidebarMenuButton = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<"button"> & {
		asChild?: boolean;
		isActive?: boolean;
		tooltip?: string | React.ComponentProps<typeof TooltipContent>;
	} & VariantProps<typeof sidebarMenuButtonVariants>
>(
	(
		{
			asChild = false,
			isActive = false,
			variant = "default",
			size = "default",
			tooltip,
			className,
			...props
		},
		ref,
	) => {
		const Comp = asChild ? Slot : "button";
		const { isMobile, state } = useSidebar();

		const button = (
			<Comp
				ref={ref}
				data-sidebar="menu-button"
				data-size={size}
				data-active={isActive}
				className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
				{...props}
			/>
		);

		if (!tooltip) {
			return button;
		}

		if (typeof tooltip === "string") {
			tooltip = {
				children: tooltip,
			};
		}

		return (
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent
					side="right"
					align="center"
					hidden={state !== "collapsed" || isMobile}
					{...tooltip}
				/>
			</Tooltip>
		);
	},
);
SidebarMenuButton.displayName = "SidebarMenuButton";

const SidebarMenuAction = React.forwardRef<
	HTMLButtonElement,
	React.ComponentProps<"button"> & {
		asChild?: boolean;
		showOnHover?: boolean;
	}
>(({ className, asChild = false, showOnHover = false, ...props }, ref) => {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			ref={ref}
			data-sidebar="menu-action"
			className={cn(
				"absolute right-1 top-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-transform hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0",
				// Increases the hit area of the button on mobile.
				"after:absolute after:-inset-2 md:after:hidden",
				"peer-data-[size=sm]/menu-button:top-1",
				"peer-data-[size=default]/menu-button:top-1.5",
				"peer-data-[size=lg]/menu-button:top-2.5",
				"group-data-[collapsible=icon]:hidden",
				showOnHover &&
					"group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
				className,
			)}
			{...props}
		/>
	);
});
SidebarMenuAction.displayName = "SidebarMenuAction";

const SidebarMenuBadge = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div">
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		data-sidebar="menu-badge"
		className={cn(
			"absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground select-none pointer-events-none",
			"peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground",
			"peer-data-[size=sm]/menu-button:top-1",
			"peer-data-[size=default]/menu-button:top-1.5",
			"peer-data-[size=lg]/menu-button:top-2.5",
			"group-data-[collapsible=icon]:hidden",
			className,
		)}
		{...props}
	/>
));
SidebarMenuBadge.displayName = "SidebarMenuBadge";

const SidebarMenuSkeleton = React.forwardRef<
	HTMLDivElement,
	React.ComponentProps<"div"> & {
		showIcon?: boolean;
	}
>(({ className, showIcon = false, ...props }, ref) => {
	// Random width between 50 to 90%.
	const width = React.useMemo(() => {
		return `${Math.floor(Math.random() * 40) + 50}%`;
	}, []);

	return (
		<div
			ref={ref}
			data-sidebar="menu-skeleton"
			className={cn("rounded-md h-8 flex gap-2 px-2 items-center", className)}
			{...props}
		>
			{showIcon && (
				<Skeleton
					className="size-4 rounded-md"
					data-sidebar="menu-skeleton-icon"
				/>
			)}
			<Skeleton
				className="h-4 flex-1 max-w-(--skeleton-width)"
				data-sidebar="menu-skeleton-text"
				style={
					{
						"--skeleton-width": width,
					} as React.CSSProperties
				}
			/>
		</div>
	);
});
SidebarMenuSkeleton.displayName = "SidebarMenuSkeleton";

const SidebarMenuSub = React.forwardRef<
	HTMLUListElement,
	React.ComponentProps<"ul">
>(({ className, ...props }, ref) => (
	<ul
		ref={ref}
		data-sidebar="menu-sub"
		className={cn(
			"mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5",
			"group-data-[collapsible=icon]:hidden",
			className,
		)}
		{...props}
	/>
));
SidebarMenuSub.displayName = "SidebarMenuSub";

const SidebarMenuSubItem = React.forwardRef<
	HTMLLIElement,
	React.ComponentProps<"li">
>(({ ...props }, ref) => <li ref={ref} {...props} />);
SidebarMenuSubItem.displayName = "SidebarMenuSubItem";

const SidebarMenuSubButton = React.forwardRef<
	HTMLAnchorElement,
	React.ComponentProps<"a"> & {
		asChild?: boolean;
		size?: "sm" | "md";
		isActive?: boolean;
	}
>(({ asChild = false, size = "md", isActive, className, ...props }, ref) => {
	const Comp = asChild ? Slot : "a";

	return (
		<Comp
			ref={ref}
			data-sidebar="menu-sub-button"
			data-size={size}
			data-active={isActive}
			className={cn(
				"flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
				"data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
				size === "sm" && "text-xs",
				size === "md" && "text-sm",
				"group-data-[collapsible=icon]:hidden",
				className,
			)}
			{...props}
		/>
	);
});
SidebarMenuSubButton.displayName = "SidebarMenuSubButton";

export {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarInset,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSkeleton,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarProvider,
	SidebarRail,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
	useOptionalSidebar,
};