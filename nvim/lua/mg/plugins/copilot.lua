return {
	{
		"copilotlsp-nvim/copilot-lsp",
		init = function()
			vim.g.copilot_nes_debounce = 500
			vim.lsp.enable("copilot_ls")
			vim.lsp.inline_completion.enable()

			vim.keymap.set("n", "<tab>", function()
				local bufnr = vim.api.nvim_get_current_buf()
				local state = vim.b[bufnr].nes_state
				if state then
					return (
						require("copilot-lsp.nes").apply_pending_nes()
						and require("copilot-lsp.nes").walk_cursor_end_edit()
					)
				end
			end, { desc = "Accept Copilot NES suggestion", expr = true })

			vim.keymap.set("n", "<esc>", function()
				if not require("copilot-lsp.nes").clear() then
					vim.cmd("nohlsearch")
				end
			end, { desc = "Clear Copilot suggestion or fallback" })
		end,
	},
}
