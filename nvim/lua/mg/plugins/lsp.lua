return {
	{
		"williamboman/mason.nvim",
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{
				"mrcjkb/rustaceanvim",
				version = "^5",
				ft = { "rust" },
			},
			{
				"j-hui/fidget.nvim",
				opts = {},
			},
			{
				"folke/lazydev.nvim",
				ft = "lua",
				opts = {
					library = {
						-- See the configuration section for more details
						-- Load luvit types when the `vim.uv` word is found
						{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
					},
				},
			},
			{ "saghen/blink.cmp" },
			{ "yioneko/nvim-vtsls" },
		},
		config = function()
			local diagnostic_icons = {
				Error = "󰅚 ",
				Warn = "󰀪 ",
				Info = "•",
				Hint = "•",
			}

			vim.diagnostic.config({
				float = {
					source = true,
					severity_sort = true,
				},
				virtual_text = {
					severity = { min = vim.diagnostic.severity.HINT },
				},
				underline = true,
				severity_sort = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = diagnostic_icons.Error,
						[vim.diagnostic.severity.WARN] = diagnostic_icons.Warn,
						[vim.diagnostic.severity.INFO] = diagnostic_icons.Info,
						[vim.diagnostic.severity.HINT] = diagnostic_icons.Hint,
					},
					numhl = {
						[vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
						[vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
					},
				},
			})

			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
					vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
					vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
					vim.keymap.set("n", "gt", vim.lsp.buf.type_definition, opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)

					vim.keymap.set("n", "gr", function()
						require("telescope.builtin").lsp_references()
					end, opts)

					vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float)
					vim.keymap.set("n", "[g", function()
						vim.diagnostic.jump({ count = -1, float = true })
					end)
					vim.keymap.set("n", "]g", function()
						vim.diagnostic.jump({ count = 1, float = true })
					end)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
					vim.keymap.set("n", "<leader>do", vim.lsp.buf.code_action, opts)

					vim.keymap.set("n", "<leader>ef", function()
						vim.cmd("LspEslintFixAll")
					end, { noremap = true })

					local eslint_group = vim.api.nvim_create_augroup("EslintFix", { clear = true })

					vim.api.nvim_create_autocmd("BufWritePre", {
						group = eslint_group,
						callback = function()
							if vim.fn.exists(":LspEslintFixAll") > 0 then
								vim.cmd("LspEslintFixAll")
							end
						end,
					})
				end,
			})

			local capabilities = require("blink.cmp").get_lsp_capabilities()

			vim.lsp.config("*", {
				capabilities = capabilities,
			})

			vim.lsp.config("eslint", {
				flags = {
					allow_incremental_sync = false,
					debounce_text_changes = 1000,
				},
			})

			vim.lsp.config("tailwindcss", {
				flags = {
					debounce_text_changes = 1000,
				},
				settings = {
					tailwindCSS = {
						classFunctions = { "cva", "clsx", "cn" },
					},
				},
			})

			vim.lsp.config("vtsls", {
				settings = {
					vtsls = {
						autoUseWorkspaceTsdk = true,
					},
					typescript = {
						tsserver = {
							maxTsServerMemory = 12288,
							pluginPaths = { "./node_modules" },
						},
					},
				},
			})

			vim.lsp.enable({
				"astro",
				"eslint",
				"jdtls",
				"lua_ls",
				"prismals",
				"pylsp",
				"rust_analyzer",
				"tailwindcss",
				"texlab",
				"vtsls",
				"biome",
			})
		end,
	},
}
