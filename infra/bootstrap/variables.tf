variable "media_upload_origins" {
  description = "Sites allowed to upload photos straight to the media bucket"
  type        = list(string)
  default     = ["https://smartdine.lab.irum.dev"]
}