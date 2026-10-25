"use client";

import React from "react";
import type { IconProps as PhosphorIconProps } from "@phosphor-icons/react/lib";
import { Wallet } from "@phosphor-icons/react/Wallet";
import { CreditCard } from "@phosphor-icons/react/CreditCard";
import { Bank } from "@phosphor-icons/react/Bank";
import { QrCode } from "@phosphor-icons/react/QrCode";
import { Scan } from "@phosphor-icons/react/Scan";
import { GearSix } from "@phosphor-icons/react/GearSix";
import { Plus } from "@phosphor-icons/react/Plus";
import { CaretLeft } from "@phosphor-icons/react/CaretLeft";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { X } from "@phosphor-icons/react/X";
import { LockKey } from "@phosphor-icons/react/LockKey";
import { ShieldCheck } from "@phosphor-icons/react/ShieldCheck";
import { Eye } from "@phosphor-icons/react/Eye";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { Copy } from "@phosphor-icons/react/Copy";
import { Check } from "@phosphor-icons/react/Check";
import { ShareNetwork } from "@phosphor-icons/react/ShareNetwork";
import { Trash } from "@phosphor-icons/react/Trash";
import { DownloadSimple } from "@phosphor-icons/react/DownloadSimple";
import { UploadSimple } from "@phosphor-icons/react/UploadSimple";
import { Palette } from "@phosphor-icons/react/Palette";
import { Lightning } from "@phosphor-icons/react/Lightning";
import { IdentificationCard } from "@phosphor-icons/react/IdentificationCard";
import { Info } from "@phosphor-icons/react/Info";
import { Shuffle } from "@phosphor-icons/react/Shuffle";

interface IconProps extends React.SVGProps<SVGSVGElement> {
  name: string;
  size?: number;
  weight?: PhosphorIconProps["weight"];
}

export default function Icon({
  name,
  size = 20,
  weight,
  ...props
}: IconProps) {
  if (name === "contactless") {
    return (
      <svg
        viewBox="0 0 256 256"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
        aria-hidden="true"
        {...props}
      >
        <path d="M96 96a48 48 0 0 1 0 64" />
        <path d="M120 72a80 80 0 0 1 0 112" />
        <path d="M144 48a112 112 0 0 1 0 160" />
      </svg>
    );
  }

  const iconMap: Record<string, React.ComponentType<PhosphorIconProps>> = {
    wallet: Wallet,
    card: CreditCard,
    bank: Bank,
    qr: QrCode,
    scan: Scan,
    settings: GearSix,
    plus: (p) => <Plus weight="bold" {...p} />,
    back: (p) => <CaretLeft weight="bold" {...p} />,
    chevron: CaretRight,
    close: (p) => <X weight="bold" {...p} />,
    lock: LockKey,
    shield: ShieldCheck,
    eye: Eye,
    eyeOff: EyeSlash,
    copy: Copy,
    check: (p) => <Check weight="bold" {...p} />,
    share: ShareNetwork,
    trash: Trash,
    download: DownloadSimple,
    upload: UploadSimple,
    palette: Palette,
    lightning: (p) => <Lightning weight="fill" {...p} />,
    fileText: IdentificationCard,
    info: Info,
    shuffle: Shuffle,
  };

  const Component = iconMap[name] || CreditCard;
  return <Component size={size} weight={weight || "regular"} {...props} />;
}
