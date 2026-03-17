export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width?: number;
  height?: number;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  media_group_id?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export type TelegramCallbackData =
  | "create_photo"
  | "analyze_ctr"
  | "improve_ctr"
  | "change_image_count"
  | "change_image_model"
  | "set_image_count_1"
  | "set_image_count_2"
  | "set_image_count_4"
  | "set_image_model_nano_pro"
  | "set_image_model_nano_flash"
  | "set_image_model_chatgpt_image_1_5"
  | "balance"
  | "buy_tokens"
  | "support"
  | "main_menu"
  | `buy_${string}`;

export interface TelegramFileResponse {
  ok: boolean;
  result: {
    file_path: string;
  };
}
