import { Input } from "@janhq/interfaces/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@janhq/interfaces/field";
import { Textarea } from "@janhq/interfaces/textarea";
import { useProfile } from "@/stores/profile-store";
import { useEffect, useRef } from "react";
import {
  BriefcaseBusinessIcon,
  CircleCheck,
  SmileIcon,
  type LucideIcon,
} from "lucide-react";

type ToneOption = "Friendly" | "Concise" | "Professional";

const toneOptions: { value: ToneOption; label: string; icon: LucideIcon }[] = [
  { value: "Friendly", label: "Friendly", icon: SmileIcon },
  { value: "Concise", label: "Concise", icon: CircleCheck },
  { value: "Professional", label: "Professional", icon: BriefcaseBusinessIcon },
];

export function PersonalizationSettings() {
  const { settings, fetchSettings, updateProfileSettings, isLoading } =
    useProfile();

  const nicknameRef = useRef<HTMLInputElement>(null);
  const occupationRef = useRef<HTMLInputElement>(null);
  const moreAboutYouRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleNicknameBlur = async () => {
    const value = nicknameRef.current?.value || "";
    if (value !== settings?.profile_settings.nick_name) {
      await updateProfileSettings({ nick_name: value });
    }
  };

  const handleOccupationBlur = async () => {
    const value = occupationRef.current?.value || "";
    if (value !== settings?.profile_settings.occupation) {
      await updateProfileSettings({ occupation: value });
    }
  };

  const handleMoreAboutYouBlur = async () => {
    const value = moreAboutYouRef.current?.value || "";
    if (value !== settings?.profile_settings.more_about_you) {
      await updateProfileSettings({ more_about_you: value });
    }
  };

  const handleToneChange = async (tone: ToneOption) => {
    await updateProfileSettings({ base_style: tone });
  };

  return (
    <div>
      <p className="text-base font-semibold mb-4 font-studio">About you</p>
      {/* Personalization */}
      <div className="mb-6">
        <FieldGroup className="gap-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-1">
            <Field>
              <FieldLabel>Nickname</FieldLabel>
              <FieldDescription>
                Jan will refer to you by this name
              </FieldDescription>
              <Input
                ref={nicknameRef}
                placeholder="Jan Doe"
                defaultValue={settings?.profile_settings.nick_name}
                onBlur={handleNicknameBlur}
                disabled={isLoading}
              />
            </Field>
            <Field>
              <FieldLabel>Work</FieldLabel>
              <FieldDescription>
                Helps Jan tailor responses to your role or profession
              </FieldDescription>
              <Input
                ref={occupationRef}
                placeholder="Marketing Manager"
                defaultValue={settings?.profile_settings.occupation}
                onBlur={handleOccupationBlur}
                disabled={isLoading}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel>Personal preferences</FieldLabel>
            <FieldDescription>
              Interests, values or preferences that Jan should keep in mind when
              responding
            </FieldDescription>
            <Textarea
              ref={moreAboutYouRef}
              placeholder="Ask clarifying questions before giving detailed answers"
              defaultValue={settings?.profile_settings.more_about_you}
              onBlur={handleMoreAboutYouBlur}
              disabled={isLoading}
            />
          </Field>
          <Field>
            <FieldLabel>Tone</FieldLabel>
            <FieldDescription>Choose how Jan responds to you</FieldDescription>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {toneOptions.map((tone) => {
                const Icon = tone.icon;
                const isSelected =
                  settings?.profile_settings.base_style === tone.value;
                return (
                  <button
                    key={tone.value}
                    type="button"
                    onClick={() => handleToneChange(tone.value)}
                    disabled={isLoading}
                    className={`flex items-center gap-3 p-4 rounded-lg border transition-all ${
                      isSelected
                        ? "border-primary bg-primary/10"
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                    } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="font-medium">{tone.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </FieldGroup>
      </div>
    </div>
  );
}
